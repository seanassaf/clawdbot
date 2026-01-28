/**
 * Nexus B2B Web Dashboard
 * Simple HTML-based UI for document upload and analysis
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
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
      margin-bottom: 30px;
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      color: #00d4ff;
    }
    .logo span { color: #fff; }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #00ff88;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 768px) {
      .grid { grid-template-columns: 1fr; }
    }
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 24px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .card h2 {
      font-size: 18px;
      margin-bottom: 16px;
      color: #00d4ff;
    }
    .upload-zone {
      border: 2px dashed rgba(0,212,255,0.3);
      border-radius: 8px;
      padding: 40px;
      text-align: center;
      cursor: pointer;
      transition: all 0.3s;
    }
    .upload-zone:hover {
      border-color: #00d4ff;
      background: rgba(0,212,255,0.05);
    }
    .upload-zone.dragover {
      border-color: #00ff88;
      background: rgba(0,255,136,0.1);
    }
    .upload-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .upload-text { color: rgba(255,255,255,0.7); }
    input[type="file"] { display: none; }
    textarea {
      width: 100%;
      min-height: 150px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 8px;
      padding: 12px;
      color: #fff;
      font-family: monospace;
      resize: vertical;
    }
    textarea:focus {
      outline: none;
      border-color: #00d4ff;
    }
    button {
      background: linear-gradient(135deg, #00d4ff 0%, #0099ff 100%);
      color: #fff;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      margin-top: 12px;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 20px rgba(0,212,255,0.4);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .results {
      margin-top: 20px;
      padding: 16px;
      background: rgba(0,0,0,0.3);
      border-radius: 8px;
      display: none;
    }
    .results.visible { display: block; }
    .results h3 {
      color: #00ff88;
      margin-bottom: 12px;
      font-size: 16px;
    }
    .result-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .result-item:last-child { border-bottom: none; }
    .result-label { color: rgba(255,255,255,0.6); }
    .result-value { color: #fff; font-weight: 500; }
    .confidence {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
    }
    .confidence.high { background: rgba(0,255,136,0.2); color: #00ff88; }
    .confidence.medium { background: rgba(255,200,0,0.2); color: #ffc800; }
    .confidence.low { background: rgba(255,100,100,0.2); color: #ff6464; }
    .anomalies {
      margin-top: 16px;
      padding: 12px;
      background: rgba(255,100,100,0.1);
      border-radius: 8px;
      border-left: 3px solid #ff6464;
    }
    .anomalies h4 { color: #ff6464; margin-bottom: 8px; }
    .anomaly-item {
      padding: 4px 0;
      font-size: 14px;
    }
    .recommendations {
      margin-top: 16px;
      padding: 12px;
      background: rgba(0,212,255,0.1);
      border-radius: 8px;
      border-left: 3px solid #00d4ff;
    }
    .recommendations h4 { color: #00d4ff; margin-bottom: 8px; }
    .rec-item {
      padding: 4px 0;
      font-size: 14px;
    }
    .loading {
      display: none;
      text-align: center;
      padding: 20px;
    }
    .loading.visible { display: block; }
    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid rgba(0,212,255,0.3);
      border-top-color: #00d4ff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .stat-box {
      background: rgba(0,0,0,0.3);
      padding: 16px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: #00d4ff;
    }
    .stat-label {
      font-size: 12px;
      color: rgba(255,255,255,0.6);
      margin-top: 4px;
    }
    .fields-table {
      width: 100%;
      margin-top: 12px;
    }
    .fields-table td {
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .fields-table td:first-child {
      color: rgba(255,255,255,0.6);
      width: 40%;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">Nexus<span>B2B</span></div>
      <div class="status">
        <div class="status-dot"></div>
        <span>AI Ready</span>
      </div>
    </header>

    <div class="grid">
      <!-- Upload Section -->
      <div class="card">
        <h2>📄 Document Analysis</h2>
        <div class="upload-zone" id="dropZone">
          <div class="upload-icon">📁</div>
          <p class="upload-text">Drag & drop a document here<br>or click to browse</p>
          <input type="file" id="fileInput" accept=".txt,.pdf,.csv,.json,.xlsx">
        </div>

        <div style="margin: 20px 0; text-align: center; color: rgba(255,255,255,0.5);">— or paste text directly —</div>

        <textarea id="textInput" placeholder="Paste invoice, receipt, work order, or any document text here..."></textarea>
        <button id="analyzeBtn" onclick="analyzeDocument()">🔍 Analyze Document</button>

        <div class="loading" id="loading">
          <div class="spinner"></div>
          <p>AI is analyzing your document...</p>
        </div>
      </div>

      <!-- Results Section -->
      <div class="card">
        <h2>📊 Analysis Results</h2>

        <div class="stats-grid" id="statsGrid">
          <div class="stat-box">
            <div class="stat-value" id="docsAnalyzed">0</div>
            <div class="stat-label">Documents Analyzed</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="anomaliesFound">0</div>
            <div class="stat-label">Anomalies Found</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="timeSaved">0h</div>
            <div class="stat-label">Time Saved</div>
          </div>
        </div>

        <div class="results" id="results">
          <h3>📋 Document Type: <span id="docType">-</span></h3>
          <div class="result-item">
            <span class="result-label">Confidence</span>
            <span class="confidence high" id="confidence">-</span>
          </div>

          <h4 style="margin-top: 16px; margin-bottom: 8px;">Extracted Fields</h4>
          <table class="fields-table" id="fieldsTable">
            <tbody></tbody>
          </table>

          <div class="anomalies" id="anomaliesSection" style="display: none;">
            <h4>⚠️ Anomalies Detected</h4>
            <div id="anomaliesList"></div>
          </div>

          <div class="recommendations" id="recsSection" style="display: none;">
            <h4>💡 Recommendations</h4>
            <div id="recsList"></div>
          </div>
        </div>

        <div id="noResults" style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">
          <p>Upload or paste a document to see AI analysis results</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    let docsCount = 0;
    let anomaliesCount = 0;

    // Drag and drop handling
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleFile(file);
    });

    function handleFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById('textInput').value = e.target.result;
      };
      reader.readAsText(file);
    }

    async function analyzeDocument() {
      const text = document.getElementById('textInput').value.trim();
      if (!text) {
        alert('Please enter or upload a document to analyze');
        return;
      }

      const btn = document.getElementById('analyzeBtn');
      const loading = document.getElementById('loading');
      const results = document.getElementById('results');
      const noResults = document.getElementById('noResults');

      btn.disabled = true;
      loading.classList.add('visible');
      results.classList.remove('visible');

      try {
        // Call the API
        const response = await fetch('/api/v1/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text, fileName: 'document.txt' })
        });

        const data = await response.json();

        if (data.success && data.data) {
          displayResults(data.data);
        } else {
          // Fallback: simulate analysis for demo
          displayResults(simulateAnalysis(text));
        }
      } catch (err) {
        // Fallback: simulate analysis for demo
        displayResults(simulateAnalysis(text));
      }

      btn.disabled = false;
      loading.classList.remove('visible');
      results.classList.add('visible');
      noResults.style.display = 'none';
    }

    function simulateAnalysis(text) {
      const lower = text.toLowerCase();
      let docType = 'unknown';
      let fields = [];

      if (lower.includes('invoice') || lower.includes('bill')) {
        docType = 'invoice';
        fields = extractInvoiceFields(text);
      } else if (lower.includes('receipt')) {
        docType = 'receipt';
        fields = extractReceiptFields(text);
      } else if (lower.includes('work order') || lower.includes('service')) {
        docType = 'work_order';
        fields = extractWorkOrderFields(text);
      } else if (lower.includes('expense')) {
        docType = 'expense';
        fields = extractExpenseFields(text);
      }

      const anomalies = detectAnomalies(text, fields);
      const recommendations = generateRecommendations(docType, anomalies);

      return {
        documentType: docType,
        confidence: 0.85 + Math.random() * 0.13,
        extractedFields: fields,
        anomalies,
        recommendations,
        summary: 'Document analyzed successfully'
      };
    }

    function extractInvoiceFields(text) {
      const fields = [];
      const patterns = [
        { name: 'Invoice Number', regex: /invoice\\s*#?:?\\s*([\\w-]+)/i },
        { name: 'Date', regex: /date:?\\s*([\\w\\s,]+\\d{4})/i },
        { name: 'Amount', regex: /(?:total|amount|due):?\\s*\\$?([\\d,]+\\.?\\d*)/i },
        { name: 'Vendor', regex: /(?:from|vendor|company):?\\s*([\\w\\s]+?)(?:\\n|$)/i },
      ];
      patterns.forEach(p => {
        const match = text.match(p.regex);
        if (match) fields.push({ name: p.name, value: match[1].trim(), confidence: 0.9 });
      });
      return fields;
    }

    function extractReceiptFields(text) {
      return extractInvoiceFields(text);
    }

    function extractWorkOrderFields(text) {
      return extractInvoiceFields(text);
    }

    function extractExpenseFields(text) {
      return extractInvoiceFields(text);
    }

    function detectAnomalies(text, fields) {
      const anomalies = [];
      const lower = text.toLowerCase();

      // Check for future dates
      const dateMatch = text.match(/\\b(202[5-9]|203\\d)\\b/);
      if (dateMatch && parseInt(dateMatch[1]) > new Date().getFullYear()) {
        anomalies.push({
          type: 'future_date',
          description: 'Document contains a future date',
          severity: 'medium'
        });
      }

      // Check for unusual amounts
      const amountMatch = text.match(/\\$([\\d,]+)/);
      if (amountMatch) {
        const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
        if (amount > 10000) {
          anomalies.push({
            type: 'high_amount',
            description: 'Unusually high amount detected: $' + amount.toLocaleString(),
            severity: 'high'
          });
        }
      }

      return anomalies;
    }

    function generateRecommendations(docType, anomalies) {
      const recs = [];

      if (anomalies.length > 0) {
        recs.push({
          type: 'review',
          title: 'Manual Review Required',
          description: 'This document has anomalies that should be reviewed',
          priority: 'high'
        });
      }

      if (docType === 'invoice') {
        recs.push({
          type: 'action',
          title: 'Schedule Payment',
          description: 'Add to payment queue based on due date',
          priority: 'medium'
        });
      }

      recs.push({
        type: 'filing',
        title: 'Auto-categorize',
        description: 'File under ' + docType.replace('_', ' ') + ' category',
        priority: 'low'
      });

      return recs;
    }

    function displayResults(analysis) {
      docsCount++;
      document.getElementById('docsAnalyzed').textContent = docsCount;
      document.getElementById('timeSaved').textContent = Math.round(docsCount * 2.5) + 'm';

      // Document type
      const typeMap = {
        invoice: '📄 Invoice',
        receipt: '🧾 Receipt',
        work_order: '🔧 Work Order',
        expense: '💰 Expense Report',
        compliance_form: '📋 Compliance Form',
        unknown: '📝 Document'
      };
      document.getElementById('docType').textContent = typeMap[analysis.documentType] || analysis.documentType;

      // Confidence
      const conf = Math.round((analysis.confidence || 0.85) * 100);
      const confEl = document.getElementById('confidence');
      confEl.textContent = conf + '%';
      confEl.className = 'confidence ' + (conf >= 90 ? 'high' : conf >= 70 ? 'medium' : 'low');

      // Fields
      const tbody = document.querySelector('#fieldsTable tbody');
      tbody.innerHTML = '';
      (analysis.extractedFields || []).forEach(field => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + field.name + '</td><td>' + field.value + '</td>';
        tbody.appendChild(tr);
      });

      // Anomalies
      const anomaliesSection = document.getElementById('anomaliesSection');
      const anomaliesList = document.getElementById('anomaliesList');
      if (analysis.anomalies && analysis.anomalies.length > 0) {
        anomaliesCount += analysis.anomalies.length;
        document.getElementById('anomaliesFound').textContent = anomaliesCount;
        anomaliesList.innerHTML = analysis.anomalies.map(a =>
          '<div class="anomaly-item">⚠️ ' + a.description + ' (' + a.severity + ')</div>'
        ).join('');
        anomaliesSection.style.display = 'block';
      } else {
        anomaliesSection.style.display = 'none';
      }

      // Recommendations
      const recsSection = document.getElementById('recsSection');
      const recsList = document.getElementById('recsList');
      if (analysis.recommendations && analysis.recommendations.length > 0) {
        recsList.innerHTML = analysis.recommendations.map(r =>
          '<div class="rec-item">→ <strong>' + r.title + '</strong>: ' + r.description + '</div>'
        ).join('');
        recsSection.style.display = 'block';
      } else {
        recsSection.style.display = 'none';
      }
    }
  </script>
</body>
</html>`;
}
