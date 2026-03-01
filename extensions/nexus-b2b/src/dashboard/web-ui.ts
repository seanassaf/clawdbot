/**
 * Nexus B2B Web Dashboard
 * Calls Anthropic Claude API directly for real AI document analysis
 */

export function getWebDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nexus B2B - AI Document Automation</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      margin-bottom: 24px;
    }
    .logo { font-size: 24px; font-weight: bold; color: #00d4ff; }
    .logo span { color: #fff; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%; background: #00ff88;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }

    /* API Key banner */
    .api-banner {
      background: rgba(0,212,255,0.1);
      border: 1px solid rgba(0,212,255,0.3);
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .api-banner label { font-size: 14px; color: rgba(255,255,255,0.8); white-space: nowrap; }
    .api-banner input {
      flex: 1;
      min-width: 200px;
      background: rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      padding: 8px 12px;
      color: #fff;
      font-size: 13px;
      font-family: monospace;
    }
    .api-banner input:focus { outline: none; border-color: #00d4ff; }
    .api-status {
      font-size: 13px;
      padding: 4px 10px;
      border-radius: 20px;
      background: rgba(0,255,136,0.15);
      color: #00ff88;
      white-space: nowrap;
    }
    .api-status.missing { background: rgba(255,100,100,0.15); color: #ff6464; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }

    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 24px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .card h2 { font-size: 18px; margin-bottom: 16px; color: #00d4ff; }

    .upload-zone {
      border: 2px dashed rgba(0,212,255,0.3);
      border-radius: 8px;
      padding: 32px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s;
    }
    .upload-zone:hover, .upload-zone.dragover {
      border-color: #00d4ff;
      background: rgba(0,212,255,0.07);
    }
    .upload-icon { font-size: 42px; margin-bottom: 12px; }
    .upload-text { color: rgba(255,255,255,0.6); font-size: 14px; line-height: 1.5; }
    .file-name { margin-top: 10px; color: #00ff88; font-size: 13px; }
    input[type="file"] { display: none; }

    .divider {
      text-align: center;
      color: rgba(255,255,255,0.4);
      font-size: 13px;
      margin: 16px 0;
    }

    textarea {
      width: 100%;
      min-height: 130px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      padding: 12px;
      color: #fff;
      font-family: monospace;
      font-size: 13px;
      resize: vertical;
    }
    textarea:focus { outline: none; border-color: #00d4ff; }

    .analyze-btn {
      width: 100%;
      background: linear-gradient(135deg, #00d4ff, #0077ff);
      color: #fff;
      border: none;
      padding: 14px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 14px;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
    }
    .analyze-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0,212,255,0.35);
    }
    .analyze-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    .loading { display: none; text-align: center; padding: 24px 0; }
    .loading.visible { display: block; }
    .spinner {
      width: 44px; height: 44px;
      border: 3px solid rgba(0,212,255,0.2);
      border-top-color: #00d4ff;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading p { color: rgba(255,255,255,0.6); font-size: 14px; }

    /* Results */
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
    .stat-box { background: rgba(0,0,0,0.3); padding: 14px; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: bold; color: #00d4ff; }
    .stat-label { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }

    .results { display: none; }
    .results.visible { display: block; }

    .doc-type-badge {
      display: inline-block;
      background: rgba(0,212,255,0.2);
      border: 1px solid rgba(0,212,255,0.4);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 15px;
      font-weight: 600;
      color: #00d4ff;
      margin-bottom: 16px;
    }

    .confidence-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .bar-track {
      flex: 1;
      height: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 3px;
      background: linear-gradient(90deg, #00d4ff, #00ff88);
      transition: width 0.8s ease;
    }
    .conf-label { font-size: 13px; color: rgba(255,255,255,0.6); }
    .conf-value { font-size: 14px; font-weight: bold; color: #00ff88; }

    .section-title {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: rgba(255,255,255,0.5);
      margin: 16px 0 8px;
    }

    .fields-table { width: 100%; border-collapse: collapse; }
    .fields-table td { padding: 7px 4px; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 14px; }
    .fields-table td:first-child { color: rgba(255,255,255,0.55); width: 45%; }
    .fields-table td:last-child { font-weight: 500; }

    .alert-box {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 14px;
    }
    .alert-box.anomaly {
      background: rgba(255,100,100,0.1);
      border-left: 3px solid #ff6464;
    }
    .alert-box.rec {
      background: rgba(0,212,255,0.08);
      border-left: 3px solid #00d4ff;
    }
    .alert-title { font-weight: 600; margin-bottom: 8px; }
    .alert-box.anomaly .alert-title { color: #ff8080; }
    .alert-box.rec .alert-title { color: #00d4ff; }
    .alert-item { padding: 4px 0; line-height: 1.5; }
    .severity-badge {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 10px;
      margin-left: 6px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .severity-high { background: rgba(255,80,80,0.25); color: #ff6464; }
    .severity-medium { background: rgba(255,200,0,0.25); color: #ffc800; }
    .severity-low { background: rgba(100,200,100,0.25); color: #80ff80; }

    .no-results {
      text-align: center;
      padding: 40px 20px;
      color: rgba(255,255,255,0.4);
    }
    .no-results p:first-child { font-size: 36px; margin-bottom: 12px; }

    .error-msg {
      background: rgba(255,80,80,0.15);
      border: 1px solid rgba(255,80,80,0.3);
      border-radius: 8px;
      padding: 12px 16px;
      margin-top: 12px;
      font-size: 14px;
      color: #ff9090;
      display: none;
    }
    .error-msg.visible { display: block; }
  </style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">Nexus<span>B2B</span></div>
    <div class="status">
      <div class="status-dot"></div>
      <span id="headerStatus">AI Ready</span>
    </div>
  </header>

  <!-- API Key setup -->
  <div class="api-banner">
    <label>🔑 Anthropic API Key:</label>
    <input type="password" id="apiKeyInput" placeholder="sk-ant-api03-..." oninput="onApiKeyChange()" />
    <div class="api-status missing" id="apiKeyStatus">Not set</div>
  </div>

  <div class="grid">
    <!-- Left: Upload -->
    <div class="card">
      <h2>📄 Upload Document</h2>

      <div class="upload-zone" id="dropZone">
        <div class="upload-icon">📁</div>
        <div class="upload-text">
          Drag &amp; drop a file here<br>
          <small>Invoices, receipts, work orders, compliance forms, photos</small>
        </div>
        <div class="file-name" id="fileName"></div>
        <input type="file" id="fileInput" accept=".txt,.pdf,.csv,.json,.png,.jpg,.jpeg,.xlsx">
      </div>

      <div class="divider">— or paste text directly —</div>

      <textarea id="textInput" placeholder="Paste document text here...&#10;&#10;Example:&#10;INVOICE #12345&#10;Vendor: ACME Corp&#10;Amount: $1,500.00"></textarea>

      <div class="error-msg" id="errorMsg"></div>

      <button class="analyze-btn" id="analyzeBtn" onclick="analyzeDocument()">
        🔍 Analyze with Claude AI
      </button>

      <div class="loading" id="loading">
        <div class="spinner"></div>
        <p>Claude is reading and analyzing your document...</p>
      </div>
    </div>

    <!-- Right: Results -->
    <div class="card">
      <h2>📊 Analysis Results</h2>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-value" id="docsAnalyzed">0</div>
          <div class="stat-label">Analyzed</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" id="anomaliesFound">0</div>
          <div class="stat-label">Anomalies</div>
        </div>
        <div class="stat-box">
          <div class="stat-value" id="timeSaved">0m</div>
          <div class="stat-label">Time Saved</div>
        </div>
      </div>

      <div class="no-results" id="noResults">
        <p>🤖</p>
        <p>Upload a document and Claude AI will extract all data, detect issues, and give recommendations.</p>
      </div>

      <div class="results" id="results">
        <div class="doc-type-badge" id="docType">—</div>

        <div class="confidence-bar">
          <span class="conf-label">Confidence</span>
          <div class="bar-track"><div class="bar-fill" id="confBar" style="width:0%"></div></div>
          <span class="conf-value" id="confValue">—</span>
        </div>

        <div id="summaryText" style="font-size:14px; color:rgba(255,255,255,0.75); line-height:1.6; margin-bottom:12px;"></div>

        <div class="section-title">Extracted Fields</div>
        <table class="fields-table"><tbody id="fieldsBody"></tbody></table>

        <div id="anomaliesBox" class="alert-box anomaly" style="display:none">
          <div class="alert-title">⚠️ Anomalies Detected</div>
          <div id="anomaliesList"></div>
        </div>

        <div id="recsBox" class="alert-box rec" style="display:none">
          <div class="alert-title">💡 Recommendations</div>
          <div id="recsList"></div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  let docsCount = 0;
  let totalAnomalies = 0;
  let currentFileContent = null;
  let currentFileType = 'text';

  // Load saved API key
  const savedKey = localStorage.getItem('nexus_api_key') || '';
  if (savedKey) {
    document.getElementById('apiKeyInput').value = savedKey;
    updateApiKeyStatus(savedKey);
  }

  function onApiKeyChange() {
    const key = document.getElementById('apiKeyInput').value.trim();
    localStorage.setItem('nexus_api_key', key);
    updateApiKeyStatus(key);
  }

  function updateApiKeyStatus(key) {
    const el = document.getElementById('apiKeyStatus');
    if (key.startsWith('sk-ant-')) {
      el.textContent = '✓ Connected';
      el.className = 'api-status';
    } else {
      el.textContent = 'Not set';
      el.className = 'api-status missing';
    }
  }

  // Drag & drop
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  function handleFile(file) {
    document.getElementById('fileName').textContent = '📎 ' + file.name;
    const isImage = file.type.startsWith('image/');
    currentFileType = isImage ? 'image' : 'text';

    if (isImage) {
      const reader = new FileReader();
      reader.onload = e => {
        currentFileContent = e.target.result; // base64 data URL
        document.getElementById('textInput').value = '';
        document.getElementById('textInput').placeholder = '(Image loaded: ' + file.name + ')';
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        currentFileContent = null;
        document.getElementById('textInput').value = e.target.result;
      };
      reader.readAsText(file);
    }
  }

  async function analyzeDocument() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    if (!apiKey.startsWith('sk-ant-')) {
      showError('Please enter your Anthropic API key at the top (starts with sk-ant-)');
      return;
    }

    const text = document.getElementById('textInput').value.trim();
    if (!text && !currentFileContent) {
      showError('Please upload a file or paste document text');
      return;
    }

    hideError();
    setLoading(true);

    try {
      const analysis = await callClaudeAPI(apiKey, text, currentFileContent, currentFileType);
      displayResults(analysis);
    } catch (err) {
      showError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function callClaudeAPI(apiKey, text, imageData, fileType) {
    const prompt = \`You are an expert B2B document analysis AI. Analyze the document and return ONLY valid JSON (no markdown, no explanation).

JSON schema to follow:
{
  "documentType": "invoice|receipt|work_order|expense|compliance_form|purchase_order|contract|unknown",
  "confidence": 0.95,
  "summary": "One sentence summary",
  "extractedFields": [
    { "name": "Field Name", "value": "field value" }
  ],
  "anomalies": [
    { "description": "What is wrong", "severity": "high|medium|low" }
  ],
  "recommendations": [
    { "title": "Action title", "description": "What to do" }
  ]
}

Document to analyze:
\${text || '[Image attached]'}\`;

    // Build message content
    const content = [];
    if (imageData) {
      const base64 = imageData.split(',')[1];
      const mimeType = imageData.split(';')[0].split(':')[1];
      content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } });
      content.push({ type: 'text', text: prompt });
    } else {
      content.push({ type: 'text', text: prompt });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'API call failed (' + response.status + ')');
    }

    const data = await response.json();
    const rawText = data.content[0].text.trim();

    // Robust JSON extraction - find the JSON object in the response
    let jsonStr = rawText;

    // Remove markdown code fences if present
    if (jsonStr.includes('\`\`\`')) {
      const match = jsonStr.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/);
      if (match) jsonStr = match[1];
    }

    // Find the JSON object boundaries
    const startIdx = jsonStr.indexOf('{');
    const endIdx = jsonStr.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonStr = jsonStr.slice(startIdx, endIdx + 1);
    }

    // Clean up any control characters that might break JSON
    jsonStr = jsonStr.replace(/[\\x00-\\x1F\\x7F]/g, ' ').trim();

    try {
      return JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'Raw:', rawText);
      // Return a fallback response
      return {
        documentType: 'unknown',
        confidence: 0.5,
        summary: 'Could not parse AI response. Raw text: ' + rawText.slice(0, 200),
        extractedFields: [],
        anomalies: [{ description: 'AI response parsing failed', severity: 'medium' }],
        recommendations: [{ title: 'Retry', description: 'Try analyzing the document again' }]
      };
    }
  }

  function displayResults(analysis) {
    docsCount++;
    document.getElementById('docsAnalyzed').textContent = docsCount;
    document.getElementById('timeSaved').textContent = Math.round(docsCount * 5) + 'm';

    // Type
    const typeLabels = {
      invoice: '📄 Invoice', receipt: '🧾 Receipt', work_order: '🔧 Work Order',
      expense: '💰 Expense Report', compliance_form: '📋 Compliance Form',
      purchase_order: '🛒 Purchase Order', contract: '📝 Contract', unknown: '📄 Document'
    };
    document.getElementById('docType').textContent = typeLabels[analysis.documentType] || analysis.documentType;

    // Confidence bar
    const conf = Math.round((analysis.confidence || 0.8) * 100);
    document.getElementById('confBar').style.width = conf + '%';
    document.getElementById('confValue').textContent = conf + '%';

    // Summary
    document.getElementById('summaryText').textContent = analysis.summary || '';

    // Fields
    const tbody = document.getElementById('fieldsBody');
    tbody.innerHTML = '';
    (analysis.extractedFields || []).forEach(f => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + escHtml(f.name) + '</td><td>' + escHtml(String(f.value)) + '</td>';
      tbody.appendChild(tr);
    });

    // Anomalies
    const anomalies = analysis.anomalies || [];
    const anomBox = document.getElementById('anomaliesBox');
    if (anomalies.length > 0) {
      totalAnomalies += anomalies.length;
      document.getElementById('anomaliesFound').textContent = totalAnomalies;
      document.getElementById('anomaliesList').innerHTML = anomalies.map(a =>
        '<div class="alert-item">• ' + escHtml(a.description) +
        '<span class="severity-badge severity-' + (a.severity||'medium') + '">' + (a.severity||'medium') + '</span></div>'
      ).join('');
      anomBox.style.display = 'block';
    } else {
      anomBox.style.display = 'none';
    }

    // Recommendations
    const recs = analysis.recommendations || [];
    const recsBox = document.getElementById('recsBox');
    if (recs.length > 0) {
      document.getElementById('recsList').innerHTML = recs.map(r =>
        '<div class="alert-item"><strong>' + escHtml(r.title) + '</strong>: ' + escHtml(r.description) + '</div>'
      ).join('');
      recsBox.style.display = 'block';
    } else {
      recsBox.style.display = 'none';
    }

    document.getElementById('noResults').style.display = 'none';
    document.getElementById('results').classList.add('visible');
  }

  function setLoading(on) {
    document.getElementById('loading').classList.toggle('visible', on);
    document.getElementById('analyzeBtn').disabled = on;
  }

  function showError(msg) {
    const el = document.getElementById('errorMsg');
    el.textContent = msg;
    el.classList.add('visible');
  }

  function hideError() {
    document.getElementById('errorMsg').classList.remove('visible');
  }

  function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
</script>
</body>
</html>`;
}
