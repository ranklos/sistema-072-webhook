import express from 'express';
import axios from 'axios';
import twilio from 'twilio';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para procesar datos de Twilio
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración de Voiceflow
const VF_API_KEY = process.env.VF_API_KEY || 'VF.DM.67651e18e496e30007bb97e6.qc4ueABq5LsBK1Pf';
const VF_VERSION_ID = 'production';
const VF_API_URL = 'https://general-runtime.voiceflow.com';

// Estado de usuarios (en memoria)
const userStates = new Map();

// Helper: Obtener o crear estado de usuario
function getUserState(userId) {
    if (!userStates.has(userId)) {
        userStates.set(userId, {
            conversationStarted: false,
            lastActivity: Date.now()
        });
    }
    return userStates.get(userId);
}

// Helper: Limpiar estado de usuario
function clearUserState(userId) {
    console.log(`🔄 Limpiando estado de usuario: ${userId}`);
    userStates.delete(userId);
}

// Helper: Extraer URL de fotos de Twilio
function extractPhotoUrls(req) {
    const numMedia = parseInt(req.body.NumMedia || '0', 10);
    const photoUrls = [];
    
    for (let i = 0; i < numMedia; i++) {
        const mediaUrl = req.body[`MediaUrl${i}`];
        const contentType = req.body[`MediaContentType${i}`];
        
        if (mediaUrl && contentType && contentType.startsWith('image/')) {
            photoUrls.push(mediaUrl);
            console.log(`📸 Foto ${i + 1} detectada: ${mediaUrl}`);
        }
    }
    
    return photoUrls;
}

// Helper: Enviar mensaje a Voiceflow
async function sendToVoiceflow(userId, userMessage, photoUrls = []) {
    try {
        const userState = getUserState(userId);
        
        // Si hay fotos, enviar el URL directamente como mensaje
        let messageToSend = userMessage;
        if (photoUrls.length > 0) {
            messageToSend = photoUrls[0]; // Enviar el primer URL de foto
            console.log(`📸 Enviando foto a Voiceflow: ${messageToSend}`);
        }
        
        const payload = {
            action: {
                type: 'text',
                payload: messageToSend
            },
            config: {
                tts: false,
                stripSSML: true,
                stopAll: true,
                excludeTypes: ['block', 'debug', 'flow']
            },
            state: {
                variables: {
                    foto_url: photoUrls.length > 0 ? photoUrls[0] : undefined
                }
            }
        };

        console.log(`🤖 Enviando a Voiceflow (usuario: ${userId}):`, JSON.stringify(payload, null, 2));

        const response = await axios.post(
            `${VF_API_URL}/state/user/${userId}/interact`,
            payload,
            {
                headers: {
                    Authorization: VF_API_KEY,
                    'Content-Type': 'application/json',
                    versionID: VF_VERSION_ID
                },
                timeout: 30000
            }
        );

        console.log(`✅ Respuesta de Voiceflow:`, JSON.stringify(response.data, null, 2));
        return response.data;
    } catch (error) {
        console.error('❌ Error al comunicarse con Voiceflow:', error.response?.data || error.message);
        throw error;
    }
}

// Helper: Procesar respuesta de Voiceflow
function processVoiceflowResponse(traces) {
    const messages = [];
    
    for (const trace of traces) {
        if (trace.type === 'text' || trace.type === 'speak') {
            const text = trace.payload?.message || trace.payload?.text || '';
            if (text) {
                messages.push(text);
            }
        } else if (trace.type === 'choice') {
            // Convertir botones en texto numerado
            const buttons = trace.payload?.buttons || [];
            if (buttons.length > 0) {
                const buttonText = buttons
                    .map((btn, idx) => `${idx + 1}) ${btn.name}`)
                    .join('\n');
                messages.push(buttonText);
            }
        }
    }
    
    return messages.join('\n\n');
}

// Endpoint principal de webhook
app.post('/webhook', async (req, res) => {
    try {
        console.log('📩 Mensaje recibido de Twilio:', JSON.stringify(req.body, null, 2));

        const from = req.body.From || '';
        const body = req.body.Body || '';
        const userId = from.replace('whatsapp:', '');
        
        // Extraer URLs de fotos
        const photoUrls = extractPhotoUrls(req);
        
        if (photoUrls.length > 0) {
            console.log(`📸 ${photoUrls.length} foto(s) detectada(s) de usuario: ${userId}`);
        }

        // Comandos especiales
        if (body.toLowerCase() === 'reset' || body.toLowerCase() === 'inicio' || body.toLowerCase() === 'reiniciar') {
            console.log(`🔄 Comando de reset recibido de: ${userId}`);
            clearUserState(userId);
            
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message('🔄 Conversación reiniciada. Envía "Hola" para comenzar de nuevo.');
            
            res.type('text/xml');
            return res.send(twiml.toString());
        }

        // Enviar mensaje (o foto) a Voiceflow
        let messageToSend = body || 'Foto enviada';
        const vfResponse = await sendToVoiceflow(userId, messageToSend, photoUrls);

        // Procesar respuesta
        const responseText = processVoiceflowResponse(vfResponse);

        // Enviar respuesta a WhatsApp
        const twiml = new twilio.twiml.MessagingResponse();
        if (responseText) {
            twiml.message(responseText);
        } else {
            twiml.message('Mensaje recibido correctamente.');
        }

        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        console.error('❌ Error en webhook:', error);
        
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message('Lo siento, hubo un error al procesar tu mensaje. Por favor intenta de nuevo.');
        
        res.type('text/xml');
        res.send(twiml.toString());
    }
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'ok',
        service: 'Sistema 072 Webhook',
        version: '3.0.0-photos',
        timestamp: new Date().toISOString(),
        features: ['voiceflow', 'twilio', 'photo-capture', 'reset-command']
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en puerto ${PORT}`);
    console.log(`📸 Captura de fotos: ACTIVADA`);
    console.log(`🔄 Comando reset: ACTIVADO`);
});
