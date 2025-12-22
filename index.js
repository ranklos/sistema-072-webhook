const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const MessagingResponse = require('twilio').twiml.MessagingResponse;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const VOICEFLOW_API_KEY = 'VF.DM.6948761e2e2af30c86b18d82.5kGMBY2qIFvu5Hg1';
const VOICEFLOW_PROJECT_ID = '6946ff58025fa2af7e791c6f';
const VOICEFLOW_VERSION_ID = 'development';
const VOICEFLOW_API_URL = 'https://general-runtime.voiceflow.com';

app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Mensaje:', JSON.stringify(req.body, null, 2));
    
    const from = req.body.From;
    const body = req.body.Body;
    const mediaUrl = req.body.MediaUrl0;
    const numMedia = req.body.NumMedia;
    const userID = from.replace('whatsapp:', '').replace('+', '');
    
    console.log('👤 Usuario:', userID);
    console.log('💬 Texto:', body);
    
    if (numMedia && parseInt(numMedia) > 0 && mediaUrl) {
      console.log('📸 Foto:', mediaUrl);
      try {
        await axios.patch(
          `${VOICEFLOW_API_URL}/state/user/${userID}/variables`,
          { foto_url: mediaUrl },
          { headers: { 'Authorization': VOICEFLOW_API_KEY, 'Content-Type': 'application/json' }}
        );
        console.log('✅ Foto guardada');
      } catch (e) {
        console.error('⚠️ Error foto:', e.message);
      }
    }
    
    console.log('🔄 Llamando Voiceflow...');
    const voiceflowResponse = await axios.post(
      `${VOICEFLOW_API_URL}/state/user/${userID}/interact`,
      {
        action: { type: 'text', payload: body || 'Hola' },
        config: { tts: false, stripSSML: true, stopAll: true, excludeTypes: ['block', 'debug', 'flow'] }
      },
      { headers: { 'Authorization': VOICEFLOW_API_KEY, 'Content-Type': 'application/json', 'versionID': VOICEFLOW_VERSION_ID }}
    );
    
    console.log('🤖 Respuesta:', JSON.stringify(voiceflowResponse.data, null, 2));
    
    let responseMessages = [];
    const traces = voiceflowResponse.data || [];
    
    traces.forEach(trace => {
      // Procesar mensajes de texto
      if (trace.type === 'text' && trace.payload && trace.payload.message) {
        responseMessages.push(trace.payload.message);
      } 
      // Procesar mensajes de voz
      else if (trace.type === 'speak' && trace.payload && trace.payload.message) {
        responseMessages.push(trace.payload.message);
      }
      // Procesar botones (choice)
      else if (trace.type === 'choice' && trace.payload && trace.payload.buttons) {
        const buttons = trace.payload.buttons;
        const buttonText = buttons.map((btn, idx) => `${idx + 1}. ${btn.name}`).join('\n');
        
        if (buttonText) {
          responseMessages.push(buttonText);
        }
      }
    });
    
    if (responseMessages.length === 0) {
      responseMessages.push('Gracias por contactar al Sistema 072.');
    }
    
    const finalMessage = responseMessages.join('\n\n');
    console.log('📤 Enviando:', finalMessage);
    
    const twiml = new MessagingResponse();
    twiml.message(finalMessage);
    res.type('text/xml');
    res.send(twiml.toString());
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Detalles:', JSON.stringify(error.response.data, null, 2));
    }
    const twiml = new MessagingResponse();
    twiml.message('Lo sentimos, ocurrió un error. Intenta nuevamente.');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

app.get('/', (req, res) => {
  res.send(`
    <html><head><title>Sistema 072</title><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .card{background:white;padding:40px;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:600px;width:100%;animation:slideIn .5s ease-out}
    @keyframes slideIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
    h1{color:#2d3748;font-size:32px;margin-bottom:10px}
    h2{color:#718096;font-size:18px;margin-bottom:25px;font-weight:400}
    .status{color:#48bb78;font-size:22px;font-weight:600;margin:25px 0;display:flex;align-items:center;gap:10px}
    .status::before{content:'●';font-size:28px;animation:pulse 2s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
    .info{background:#f7fafc;padding:25px;border-radius:12px;border-left:5px solid #667eea;margin:25px 0}
    .info-item{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #e2e8f0}
    .info-item:last-child{border-bottom:none}
    .label{font-weight:600;color:#4a5568}
    .value{color:#718096;font-family:'Courier New',monospace;font-size:14px}
    .badges{margin-top:25px;display:flex;flex-wrap:wrap;gap:10px}
    .badge{background:#667eea;color:white;padding:8px 16px;border-radius:20px;font-size:13px}
    </style></head><body><div class="card">
    <h1>🤖 Sistema 072</h1><h2>Municipio de Durango</h2>
    <div class="status">Webhook Activo</div>
    <div class="info">
    <div class="info-item"><span class="label">Estado:</span><span class="value">🟢 Online</span></div>
    <div class="info-item"><span class="label">Endpoint:</span><span class="value">/webhook</span></div>
    <div class="info-item"><span class="label">Project ID:</span><span class="value">${VOICEFLOW_PROJECT_ID}</span></div>
    <div class="info-item"><span class="label">Versión:</span><span class="value">${VOICEFLOW_VERSION_ID}</span></div>
    <div class="info-item"><span class="label">Actualización:</span><span class="value">${new Date().toLocaleString('es-MX')}</span></div>
    </div>
    <div class="badges">
    <span class="badge">✓ WhatsApp</span>
    <span class="badge">✓ Voiceflow</span>
    <span class="badge">✓ Google Sheets</span>
    <span class="badge">✓ Botones Soportados</span>
    </div></div></body></html>
  `);
});

app.get('/test', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Sistema 072 Webhook',
    timestamp: new Date().toISOString(),
    voiceflow_project: VOICEFLOW_PROJECT_ID,
    features: ['text', 'images', 'buttons']
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Webhook activo en puerto', PORT);
});

module.exports = app;
