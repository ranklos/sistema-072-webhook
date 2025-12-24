import express from 'express';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// CONFIGURACIÓN META WHATSAPP
// ============================================
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || 'EAAUeHuGqLnkBQW3Hm5yV4SbfQ5zA0CDydm9TaP5AhUvcqfIg0wUgxZADmhZB6UQK2yNc6H46u3H1abzm4TGvX3ZAboE1k94mV5W11XUZBea0bPRDswTZAfIBbzLsZBhPxdp41WTQRSlGpIV7u0BOg8Ck7FYPWVQJY4vP9R0LkCfKb8jVsejLKhgon6GKTBUjHfeM0QmIIvkSI3aG2wBiQoFPC3aMTpJGPOWRc1xRiXBJuJZCws2BCfWZCePteZALPpUPZAuxb5aLVcgCYJ6SVCwgCjSy25nTpLybGs';
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || '872491752621526';
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'sistema072_verify_token_2024';
const META_WHATSAPP_ACCOUNT_ID = process.env.META_WHATSAPP_ACCOUNT_ID || '1417886129685401';

// ============================================
// CONFIGURACIÓN VOICEFLOW
// ============================================
const VF_API_KEY = process.env.VF_API_KEY || 'VF.DM.6948761e2e2af30c86b18d82.5kGMBY2qIFvu5Hg1';
const VF_VERSION_ID = 'production';
const VF_API_URL = 'https://general-runtime.voiceflow.com';

// Estado de usuarios (en memoria)
const userStates = new Map();

// ============================================
// HELPERS
// ============================================

// Obtener o crear estado de usuario
function getUserState(userId) {
    if (!userStates.has(userId)) {
        userStates.set(userId, {
            conversationStarted: false,
            lastActivity: Date.now()
        });
    }
    return userStates.get(userId);
}

// Limpiar estado de usuario
function clearUserState(userId) {
    console.log(`🔄 Limpiando estado de usuario: ${userId}`);
    userStates.delete(userId);
    
    // También limpiar estado en Voiceflow
    return axios.delete(`${VF_API_URL}/state/user/${userId}`, {
        headers: {
            Authorization: VF_API_KEY,
            versionID: VF_VERSION_ID
        }
    }).catch(err => console.error('Error limpiando Voiceflow:', err.message));
}

// Enviar mensaje a Voiceflow
async function sendToVoiceflow(userId, userMessage, photoUrl = null) {
    try {
        const payload = {
            action: {
                type: 'text',
                payload: photoUrl || userMessage
            },
            config: {
                tts: false,
                stripSSML: true,
                stopAll: true,
                excludeTypes: ['block', 'debug', 'flow']
            },
            state: {
                variables: {
                    foto_url: photoUrl || undefined
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

        console.log(`✅ Respuesta de Voiceflow recibida`);
        return response.data;
    } catch (error) {
        console.error('❌ Error al comunicarse con Voiceflow:', error.response?.data || error.message);
        throw error;
    }
}

// Procesar respuesta de Voiceflow
function processVoiceflowResponse(traces) {
    const messages = [];
    
    for (const trace of traces) {
        if (trace.type === 'text' || trace.type === 'speak') {
            const text = trace.payload?.message || trace.payload?.text || '';
            if (text) {
                messages.push(text);
            }
        } else if (trace.type === 'choice') {
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

// Enviar mensaje por Meta WhatsApp
async function sendWhatsAppMessage(to, message) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/v22.0/${META_PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: to,
                type: 'text',
                text: { body: message }
            },
            {
                headers: {
                    'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('✅ Mensaje enviado a WhatsApp:', response.data);
        return response.data;
    } catch (error) {
        console.error('❌ Error enviando mensaje a WhatsApp:', error.response?.data || error.message);
        throw error;
    }
}

// ============================================
// WEBHOOK VERIFICATION (GET)
// ============================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('🔍 Verificación de webhook recibida');
    console.log('Mode:', mode);
    console.log('Token recibido:', token);
    console.log('Token esperado:', META_VERIFY_TOKEN);

    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
        console.log('✅ Webhook verificado correctamente');
        res.status(200).send(challenge);
    } else {
        console.error('❌ Verificación de webhook fallida');
        res.status(403).send('Forbidden');
    }
});

// ============================================
// WEBHOOK MESSAGES (POST)
// ============================================
app.post('/webhook', async (req, res) => {
    try {
        console.log('📩 Webhook recibido de Meta:', JSON.stringify(req.body, null, 2));

        // Validar estructura
        const entry = req.body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const messages = value?.messages;

        if (!messages || messages.length === 0) {
            console.log('⚠️ Sin mensajes en el webhook (probablemente status update)');
            return res.sendStatus(200);
        }

        const message = messages[0];
        const from = message.from; // Número del usuario
        const messageType = message.type;
        const userId = from;

        console.log(`👤 Usuario: ${userId}`);
        console.log(`📝 Tipo de mensaje: ${messageType}`);

        let userMessage = '';
        let photoUrl = null;

        // Procesar según tipo de mensaje
        if (messageType === 'text') {
            userMessage = message.text.body;
            console.log(`💬 Mensaje de texto: "${userMessage}"`);
        } else if (messageType === 'image') {
            const imageId = message.image.id;
            photoUrl = `https://graph.facebook.com/v22.0/${imageId}`;
            userMessage = message.image.caption || 'Foto enviada';
            console.log(`📸 Foto recibida: ${photoUrl}`);
        } else {
            console.log(`⚠️ Tipo de mensaje no soportado: ${messageType}`);
            await sendWhatsAppMessage(from, 'Lo siento, solo puedo procesar mensajes de texto y fotos.');
            return res.sendStatus(200);
        }

        // Comandos especiales
        if (userMessage.toLowerCase() === 'reset' || 
            userMessage.toLowerCase() === 'inicio' || 
            userMessage.toLowerCase() === 'reiniciar') {
            console.log(`🔄 Comando de reset recibido de: ${userId}`);
            await clearUserState(userId);
            await sendWhatsAppMessage(from, '🔄 Conversación reiniciada. Envía "Hola" para comenzar de nuevo.');
            return res.sendStatus(200);
        }

        // Enviar a Voiceflow
        const vfResponse = await sendToVoiceflow(userId, userMessage, photoUrl);
        const responseText = processVoiceflowResponse(vfResponse);

        // Enviar respuesta a WhatsApp
        if (responseText) {
            await sendWhatsAppMessage(from, responseText);
        } else {
            await sendWhatsAppMessage(from, 'Mensaje recibido correctamente.');
        }

        res.sendStatus(200);

    } catch (error) {
        console.error('❌ Error en webhook:', error);
        res.sendStatus(500);
    }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Sistema 072 - Meta WhatsApp Webhook',
        version: '4.0.0-meta',
        timestamp: new Date().toISOString(),
        config: {
            phone_number_id: META_PHONE_NUMBER_ID,
            account_id: META_WHATSAPP_ACCOUNT_ID,
            voiceflow_connected: !!VF_API_KEY
        },
        features: [
            'meta-whatsapp',
            'voiceflow',
            'photo-capture',
            'reset-command',
            'webhook-verification'
        ]
    });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en puerto ${PORT}`);
    console.log(`📱 Meta WhatsApp: CONFIGURADO`);
    console.log(`   - Phone Number ID: ${META_PHONE_NUMBER_ID}`);
    console.log(`   - Account ID: ${META_WHATSAPP_ACCOUNT_ID}`);
    console.log(`🤖 Voiceflow: CONECTADO`);
    console.log(`📸 Captura de fotos: ACTIVADA`);
    console.log(`🔄 Comando reset: ACTIVADO`);
    console.log(`🔒 Verify Token: ${META_VERIFY_TOKEN}`);
});
