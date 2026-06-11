async function run() {
  try {
    const res = await fetch('http://localhost:3000/api/debug-worker');
    const data = await res.json();
    console.log("Debug Worker Data:", JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error fetching debug worker:", e.message);
  }
}
run();
