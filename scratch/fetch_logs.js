async function run() {
  try {
    // Login
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password' }) // Wait, let's check what the admin credentials are
    });
    
    const cookie = loginRes.headers.get('set-cookie');
    console.log("Login status:", loginRes.status);
    
    const logsRes = await fetch('http://localhost:3000/api/admin/downloader/logs', {
      headers: {
        'Cookie': cookie || ''
      }
    });
    
    const data = await logsRes.json();
    console.log("Logs:", data.logs);
    console.log("Stats:", data.stats);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
