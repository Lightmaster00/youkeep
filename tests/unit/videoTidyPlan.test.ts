import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { planTidy, nodePlannerFs, type PlannerFs } from '../../server/utils/videoTidy';
import { buildVideoPaths } from '../../server/utils/videoPaths';
import { createTestDb, insertChannel, insertVideo } from '../helpers/testDb';

let db: Database.Database;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yk-plan-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(rel: string, content = 'x') {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function legacyRow(channelId: string, channelFolder: string, id: string, title: string) {
  insertVideo(db, { id, channelId, title, localVideoPath: `/downloads/${channelFolder}/${id}.mp4`, localThumbnailPath: `/downloads/${channelFolder}/${id}.jpg` });
}

function tree(root: string): string[] {
  return fs.readdirSync(root, { recursive: true }).map(String).sort();
}

describe('planTidy', () => {
  it('counts every case without touching the disk', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: path.join(dir, 'Dup') });
    insertChannel(db, { id: 'c3', title: 'Locked' });

    const tidy = buildVideoPaths({ baseDir: dir, channelFolder: 'Chan', title: 'Tidy', id: 'v-tidy' });
    insertVideo(db, { id: 'v-tidy', channelId: 'c1', title: 'Tidy', localVideoPath: tidy.videoUrlFor('mp4') });
    write(path.join('Chan', tidy.baseName, `${tidy.baseName}.mp4`));

    legacyRow('c1', 'Chan', 'v-move', 'Move Me');
    write('Chan/v-move.mp4'); write('Chan/v-move.jpg');
    legacyRow('c1', 'Chan', 'v-missing', 'Gone');
    legacyRow('c1', 'Chan', 'v-conflict', 'Conflict');
    write('Chan/v-conflict.mp4'); write('Chan/Conflict [v-conflict]/foreign.txt');
    // Only the completed-status rule keeps this one out: it has a legacy path and a real file.
    insertVideo(db, { id: 'v-pending', channelId: 'c1', title: 'Pending', downloadStatus: 'pending', localVideoPath: '/downloads/Chan/v-pending.mp4' });
    write('Chan/v-pending.mp4');
    legacyRow('c2', 'Dup', 'd1', 'Dup Clip');
    write('Dup/Dup/d1.mp4');
    legacyRow('c3', 'Locked', 'v-locked', 'Locked Clip');
    write('Locked/v-locked.mp4');

    const locked = path.join(dir, 'Locked');
    const plannerFs = { ...nodePlannerFs, accessSync: (p: string, mode?: number) => { if (p === locked) throw new Error('EACCES'); fs.accessSync(p, mode); } };
    const before = tree(dir);

    const plan = planTidy(db, { downloadsDir: dir, fs: plannerFs });

    expect(tree(dir)).toEqual(before);
    expect(plan.preview).toMatchObject({ total: 6, toMove: 2, alreadyTidy: 1, missingFiles: 1, conflicts: 1, notWritable: 1, duplicateFolders: 1 });
    expect(plan.preview.samples).toEqual([
      { id: 'v-move', title: 'Move Me', from: path.join(dir, 'Chan', 'v-move.mp4'), to: path.join(dir, 'Chan', 'Move Me [v-move]', 'Move Me [v-move].mp4') },
      { id: 'd1', title: 'Dup Clip', from: path.join(dir, 'Dup', 'Dup', 'd1.mp4'), to: path.join(dir, 'Dup', 'Dup Clip [d1]', 'Dup Clip [d1].mp4') },
    ]);
    expect(plan.preview.channels).toEqual([
      { channelId: 'c1', channel: 'Chan', toMove: 1 },
      { channelId: 'c2', channel: 'Dup', toMove: 1 },
    ]);
    expect(plan.channelFixes).toEqual([{ channelId: 'c2', from: path.join(dir, 'Dup'), to: dir }]);
  });

  it('plans the video, its thumbnail and every subtitle under the new names and URLs', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    legacyRow('c1', 'Chan', 'v1', 'Ep #1: what?');
    for (const f of ['v1.mp4', 'v1.jpg', 'v1.fr.vtt', 'v1.en-US.vtt', 'v10.mp4']) write(`Chan/${f}`);

    const [item] = planTidy(db, { downloadsDir: dir }).items;

    const base = 'Ep #1_ what_ [v1]';
    expect(item!.toDir).toBe(path.join(dir, 'Chan', base));
    expect(item!.moves.map((m) => path.basename(m.to)).sort()).toEqual([`${base}.en-US.vtt`, `${base}.fr.vtt`, `${base}.jpg`, `${base}.mp4`]);
    const folder = encodeURIComponent(base);
    expect(item!.newVideoUrl).toBe(`/downloads/Chan/${folder}/${folder}.mp4`);
    expect(item!.newThumbUrl).toBe(`/downloads/Chan/${folder}/${folder}.jpg`);
  });

  it('plans the legacy .info.json and .description leftovers with the video, under the new names', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    legacyRow('c1', 'Chan', 'v1', 'Clip');
    for (const f of ['v1.mp4', 'v1.info.json', 'v1.description', 'v10.info.json', 'v10.description']) write(`Chan/${f}`);

    const [item] = planTidy(db, { downloadsDir: dir }).items;

    expect(item!.moves.map((m) => [path.basename(m.from), path.basename(m.to)])).toEqual([
      ['v1.mp4', 'Clip [v1].mp4'],
      ['v1.info.json', 'Clip [v1].info.json'],
      ['v1.description', 'Clip [v1].description'],
    ]);
  });

  it('never plans a leftover over a different file already at the destination', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    legacyRow('c1', 'Chan', 'v1', 'Clip');
    write('Chan/v1.mp4'); write('Chan/v1.info.json', '{"a":1}'); write('Chan/Clip [v1]/Clip [v1].info.json', 'different');

    expect(planTidy(db, { downloadsDir: dir }).preview).toMatchObject({ toMove: 0, conflicts: 1 });
  });

  it('never plans to overwrite a different file already at the destination', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    legacyRow('c1', 'Chan', 'v1', 'Clip');
    write('Chan/v1.mp4', 'new'); write('Chan/Clip [v1]/Clip [v1].mp4', 'other bytes');

    const plan = planTidy(db, { downloadsDir: dir });

    expect(plan.preview).toMatchObject({ toMove: 0, conflicts: 1 });
  });

  it('repairs a doubled channel holding new-layout folders without overwriting anything', () => {
    const custom = path.join(dir, 'Dup');
    insertChannel(db, { id: 'c2', title: 'Dup', customSavePath: custom });
    const add = (id: string, title: string) => {
      const p = buildVideoPaths({ baseDir: custom, channelFolder: 'Dup', title, id });
      insertVideo(db, { id, channelId: 'c2', title, localVideoPath: p.videoUrlFor('mp4'), localThumbnailPath: p.thumbUrlFor('jpg') });
      return p.baseName;
    };
    const done = add('a', 'Done');
    write(`Dup/${done}/${done}.mp4`);
    const nested = add('b', 'Nested');
    for (const f of [`${nested}.mp4`, `${nested}.fr.vtt`, `${nested}.jpg`, 'stray.part']) write(`Dup/Dup/${nested}/${f}`);
    add('c', 'Nowhere');
    const clash = add('d', 'Clash');
    write(`Dup/Dup/${clash}/${clash}.mp4`); write(`Dup/Dup/${clash}/${clash}.jpg`, 'small');
    write(`Dup/${clash}/${clash}.jpg`, 'a different thumbnail');

    const plan = planTidy(db, { downloadsDir: dir });

    expect(plan.preview).toMatchObject({ total: 4, alreadyTidy: 1, toMove: 1, missingFiles: 1, conflicts: 1 });
    const [item] = plan.items;
    expect(item).toMatchObject({ id: 'b', kind: 'duplicate', toDir: path.join(custom, nested) });
    expect(item!.moves.map((m) => path.basename(m.from))).toEqual([`${nested}.mp4`, `${nested}.fr.vtt`, `${nested}.jpg`]);
    expect(item!.cleanupDirs).toEqual([path.join(custom, 'Dup', nested), path.join(custom, 'Dup')]);
    expect(item!.newVideoUrl).toBe(item!.oldVideoUrl);
  });

  it('lists a big channel folder once, however many videos it holds', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    for (let i = 0; i < 200; i++) {
      const id = `v${String(i).padStart(3, '0')}`;
      legacyRow('c1', 'Chan', id, `Clip ${i}`);
      write(`Chan/${id}.mp4`); write(`Chan/${id}.jpg`); write(`Chan/${id}.en.vtt`);
    }
    const channelDir = path.join(dir, 'Chan');
    let channelListings = 0;
    const counting: PlannerFs = { ...nodePlannerFs, readdirSync: (p) => { if (p === channelDir) channelListings++; return nodePlannerFs.readdirSync(p); } };

    const plan = planTidy(db, { downloadsDir: dir, fs: counting });

    expect(plan.preview.toMove).toBe(200);
    expect(plan.items[7]!.moves.map((m) => path.basename(m.from))).toEqual(['v007.mp4', 'v007.jpg', 'v007.en.vtt']);
    expect(channelListings).toBe(1);
    expect(plan.preview.samples).toHaveLength(10);
  });

  it('keeps a move an interrupted run already made, and drops a thumbnail whose file is gone', () => {
    insertChannel(db, { id: 'c1', title: 'Chan' });
    legacyRow('c1', 'Chan', 'v1', 'Half');
    write('Chan/Half [v1]/Half [v1].mp4', 'moved');
    legacyRow('c1', 'Chan', 'v2', 'NoThumb');
    write('Chan/v2.mp4');

    const [half, noThumb] = planTidy(db, { downloadsDir: dir }).items;

    expect(half!.moves[0]).toEqual({ from: path.join(dir, 'Chan', 'v1.mp4'), to: path.join(dir, 'Chan', 'Half [v1]', 'Half [v1].mp4'), size: 5 });
    expect(noThumb!.moves).toHaveLength(1);
    expect(noThumb!.newThumbUrl).toBeNull();
  });

  it('reports a channel whose folder name would point at the base folder as a conflict', () => {
    insertChannel(db, { id: 'c1', title: '..' });
    legacyRow('c1', '..', 'v1', 'Escape');
    write('v1.mp4');

    expect(planTidy(db, { downloadsDir: path.join(dir, 'base') }).preview).toMatchObject({ total: 1, toMove: 0, conflicts: 1 });
  });
});
