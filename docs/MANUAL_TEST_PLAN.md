# Cahier de recette — YouKeep

Ce document est un cahier de recette : il permet de vérifier, depuis l'interface (sans accès technique au serveur, aux fichiers ou à la base de données), que les parcours utilisateurs de YouKeep fonctionnent comme attendu. Il couvre deux profils : l'**utilisateur standard** et l'**administrateur** (dans un déploiement auto-hébergé, l'admin est souvent l'utilisateur final lui-même).

## Comment utiliser ce document

Pour chaque cas de test : suivre les étapes, comparer avec le résultat attendu, cocher ✅ (conforme) ou ❌ (non conforme, à décrire dans "Remarques"), noter la date et le testeur.

**Avant de commencer :**
- [ ] Utiliser un environnement de test si possible (pas les données réelles de production)
- [ ] Prévoir un compte admin et un compte utilisateur standard
- [ ] Avoir au moins 2 chaînes avec du contenu téléchargé pour tester les parcours de navigation

---

## Partie A — Utilisateur standard

### A1. Connexion et compte

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| A1.1 | Connexion réussie | Saisir un identifiant et mot de passe valides sur la page de connexion | Connexion réussie, redirection vers la page d'accueil | | |
| A1.2 | Connexion refusée | Saisir un mauvais mot de passe | Message d'erreur clair, pas de connexion | | |
| A1.3 | Changement de mot de passe obligatoire | Se connecter avec un compte fraîchement créé par l'admin (mot de passe temporaire) | L'application impose de choisir un nouveau mot de passe avant de continuer | | |
| A1.4 | Déconnexion | Cliquer sur "déconnexion" | Retour à l'écran de connexion, impossible d'accéder aux pages protégées ensuite | | |
| A1.5 | Modifier son profil | Aller dans "Compte", modifier nom/prénom/email/téléphone, enregistrer | Les informations sont sauvegardées et toujours présentes après rafraîchissement de la page | | |
| A1.6 | Changer son mot de passe | Depuis "Compte", saisir l'ancien mot de passe puis un nouveau, valider | Confirmation de succès ; la reconnexion fonctionne uniquement avec le nouveau mot de passe | | |
| A1.7 | Rejet d'un mot de passe trop court | Tenter de définir un nouveau mot de passe de moins de 8 caractères | Message d'erreur, changement refusé | | |

### A2. Découverte et navigation

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| A2.1 | Page d'accueil | Se connecter et consulter la page d'accueil | Un flux de vidéos s'affiche, avec miniatures, titres et noms de chaînes | | |
| A2.2 | Parcourir les chaînes | Ouvrir l'onglet "Chaînes" | La liste des chaînes disponibles s'affiche correctement (avatar, description) | | |
| A2.3 | Consulter une chaîne | Cliquer sur une chaîne | La page de la chaîne affiche ses vidéos et ses playlists | | |
| A2.4 | Rechercher du contenu | Utiliser la barre de recherche avec un mot présent dans un titre de vidéo | Les résultats pertinents s'affichent rapidement | | |
| A2.5 | S'abonner à une chaîne | Depuis une page de chaîne, cliquer "s'abonner" | La chaîne apparaît ensuite dans l'onglet "Abonnements" | | |
| A2.6 | Se désabonner | Cliquer "se désabonner" sur une chaîne suivie | La chaîne disparaît de l'onglet "Abonnements" | | |
| A2.7 | Filtrer par abonnements | Sur la page d'accueil, filtrer pour ne voir que le contenu des chaînes suivies | Seules les vidéos des chaînes suivies s'affichent | | |

### A3. Visionnage

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| A3.1 | Lire une vidéo | Cliquer sur une vidéo depuis l'accueil ou une chaîne | La vidéo se charge et se lit sans erreur | | |
| A3.2 | Naviguer dans la vidéo | Déplacer la barre de lecture en avant/arrière | La lecture reprend immédiatement à la nouvelle position, sans blocage | | |
| A3.3 | Historique de visionnage | Regarder une vidéo quelques secondes, revenir plus tard sur la page | La vidéo apparaît comme déjà vue / la reprise de lecture est proposée | | |
| A3.4 | Masquer une vidéo | Depuis le menu d'une vidéo, choisir "masquer" | La vidéo n'apparaît plus dans les recommandations de ce compte | | |
| A3.5 | Signaler une vidéo | Utiliser la fonction "signaler" et indiquer un motif | Confirmation que le signalement a été envoyé | | |
| A3.6 | Sous-titres | Si une vidéo propose des sous-titres, les activer | Les sous-titres s'affichent dans la langue choisie | | |
| A3.7 | Vue Shorts | Ouvrir l'onglet "Shorts" et faire défiler | Défilement fluide, lecture automatique de chaque vidéo affichée | | |

### A4. Playlists personnelles

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| A4.1 | Créer une playlist | Depuis "Playlists", créer une nouvelle playlist avec un titre | La playlist apparaît dans la liste | | |
| A4.2 | Ajouter une vidéo à une playlist | Depuis le menu d'une vidéo, l'ajouter à une playlist existante | La vidéo apparaît dans la playlist concernée | | |
| A4.3 | Retirer une vidéo | Depuis la playlist, retirer une vidéo | La vidéo disparaît de la playlist | | |
| A4.4 | Renommer / modifier une playlist | Modifier le titre ou la description d'une playlist | Les changements sont sauvegardés | | |
| A4.5 | Supprimer une playlist | Supprimer une playlist personnelle | La playlist disparaît définitivement de la liste | | |
| A4.6 | Partager une playlist | Rendre une playlist publique ou "non répertoriée", copier le lien de partage, l'ouvrir dans une navigation privée | Le contenu de la playlist est visible via ce lien sans avoir besoin de se connecter | | |
| A4.7 | Playlist privée non accessible | Créer une playlist "privée", tenter d'y accéder avec un autre compte | Accès refusé | | |

### A5. Contenu restreint (visibilité)

Ces cas de test valident, du point de vue d'un utilisateur, qu'une restriction d'accès configurée par l'admin est bien respectée à l'usage.

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| A5.1 | Contenu restreint invisible sans autorisation | Avec un compte standard n'ayant pas d'autorisation particulière, essayer de trouver une chaîne/vidéo marquée comme restreinte par l'admin (recherche, navigation, ou lien direct communiqué par l'admin pour le test) | Le contenu n'apparaît dans aucune liste (accueil, recherche, playlists) et l'accès direct est refusé | | |
| A5.2 | Contenu restreint visible après autorisation | Demander à l'admin d'accorder l'accès à ce compte, puis retester | Le contenu devient visible et lisible normalement | | |
| A5.3 | Lien de partage vers un contenu restreint | Obtenir un lien de partage généré par l'admin pour une vidéo restreinte, l'ouvrir sans être connecté | La vidéo est accessible uniquement via ce lien précis | | |

---

## Partie B — Administrateur

### B1. Mise en route

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| B1.1 | Configuration initiale | Lancer l'application pour la toute première fois | Un écran de création du compte administrateur s'affiche (pas un écran de connexion classique) | | |
| B1.2 | Un seul compte admin initial | Une fois la configuration terminée, recharger la page de configuration | Impossible de recréer un compte admin par ce biais | | |

### B2. Gestion des chaînes

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| B2.1 | Ajouter une chaîne | Rechercher une chaîne YouTube par nom ou lien, l'ajouter | La chaîne apparaît dans la liste avec ses informations (titre, avatar) | | |
| B2.2 | Configurer les téléchargements | Choisir de télécharger vidéos / shorts / lives, définir une date de début | Seul le contenu correspondant aux critères est téléchargé par la suite | | |
| B2.3 | Synchroniser une chaîne | Déclencher une synchronisation manuelle | De nouvelles vidéos apparaissent dans la file d'attente si disponibles | | |
| B2.4 | Synchroniser les playlists d'une chaîne | Déclencher la synchronisation des playlists | Les playlists de la chaîne apparaissent avec leur contenu | | |
| B2.5 | Mettre une chaîne en pause | Mettre une chaîne en pause | Plus aucune nouvelle synchronisation automatique tant qu'elle est en pause | | |
| B2.6 | Modifier la visibilité d'une chaîne | Changer la visibilité d'une chaîne (publique / privée / ultra privée) | Le comportement observé côté utilisateur correspond à la nouvelle visibilité (voir A5) | | |
| B2.7 | Supprimer une chaîne | Supprimer une chaîne contenant des vidéos déjà téléchargées | La chaîne et ses vidéos disparaissent de l'application ; l'espace disque utilisé par cette chaîne est libéré | | |

### B3. Gestion du téléchargeur

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| B3.1 | Suivre la file d'attente | Ouvrir le tableau de bord du téléchargeur | La liste des téléchargements en cours/en attente s'affiche avec leur progression | | |
| B3.2 | Prioriser un téléchargement | Faire remonter une vidéo en tête de file | Elle est traitée avant les autres | | |
| B3.3 | Mettre en pause / reprendre | Mettre le téléchargeur en pause globale, puis le réactiver | Plus aucun téléchargement ne démarre pendant la pause ; les téléchargements reprennent normalement ensuite | | |
| B3.4 | Annuler un téléchargement | Annuler un téléchargement en cours | Le téléchargement s'arrête, la vidéo repasse en attente ou disparaît de la file selon l'action choisie | | |
| B3.5 | Relancer un échec | Utiliser "réessayer" sur un téléchargement en échec | Le téléchargement repart | | |
| B3.6 | Vider la file d'attente | Utiliser l'action "vider la file" | Les téléchargements en attente sont retirés | | |
| B3.7 | Synchronisation globale | Déclencher une synchronisation de toutes les chaînes actives | Le statut de synchronisation globale s'affiche et se termine sans erreur visible | | |
| B3.8 | Planifier une synchronisation automatique | Activer une synchronisation planifiée à une heure donnée | À l'heure prévue, une nouvelle synchronisation démarre automatiquement (à vérifier sur un cycle complet) | | |
| B3.9 | Consulter les journaux | Ouvrir la page de logs pendant un téléchargement actif | Les journaux se mettent à jour en direct | | |
| B3.10 | Redémarrage propre | Redémarrer l'application pendant qu'un téléchargement est en cours, puis revérifier la file | Aucun téléchargement ne reste bloqué indéfiniment en "en cours" ; il repasse en attente ou en échec | | |

### B4. Gestion des utilisateurs

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| B4.1 | Créer un utilisateur | Créer un nouveau compte utilisateur standard | Le compte est utilisable, avec mot de passe temporaire à changer à la première connexion | | |
| B4.2 | Modifier le rôle | Passer un utilisateur de standard à admin (et inversement) | Les droits changent bien après reconnexion | | |
| B4.3 | Accorder l'accès à une chaîne restreinte | Donner à un utilisateur l'accès à une chaîne "ultra privée" | L'utilisateur concerné peut désormais voir cette chaîne (voir A5.2) | | |
| B4.4 | Réinitialiser un mot de passe | Réinitialiser le mot de passe d'un utilisateur | Un nouveau mot de passe temporaire est généré et fonctionne à la connexion | | |
| B4.5 | Supprimer un utilisateur | Supprimer un compte utilisateur | Le compte ne peut plus se connecter | | |
| B4.6 | Protection du compte admin principal | Tenter de se supprimer soi-même ou de supprimer le compte admin principal | Action bloquée avec un message explicite | | |

### B5. Tableau de bord

| # | Scénario | Étapes | Résultat attendu | ✅/❌ | Remarques |
|---|---|---|---|---|---|
| B5.1 | Statistiques globales | Consulter le tableau de bord des statistiques | Les chiffres affichés (nombre de vidéos, chaînes, espace utilisé) semblent cohérents avec la réalité | | |

---

## Synthèse

| Partie | Nb de cas | ✅ Conformes | ❌ Non conformes | Non testés |
|---|---|---|---|---|
| A1. Connexion et compte | 7 | | | |
| A2. Découverte et navigation | 7 | | | |
| A3. Visionnage | 7 | | | |
| A4. Playlists personnelles | 7 | | | |
| A5. Contenu restreint | 3 | | | |
| B1. Mise en route | 2 | | | |
| B2. Gestion des chaînes | 7 | | | |
| B3. Gestion du téléchargeur | 10 | | | |
| B4. Gestion des utilisateurs | 6 | | | |
| B5. Tableau de bord | 1 | | | |
| **Total** | **57** | | | |

**Testeur :** ______________  **Date de la campagne :** ______________  **Version testée :** ______________
