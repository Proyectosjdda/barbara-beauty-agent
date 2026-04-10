const { GoogleGenerativeAI } = require('@google/generative-ai');
const { blockSlot, unblockSlot } = require('./database');
const moment = require('moment');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function processManagerCommand(message) {
    if (!process.env.GEMINI_API_KEY) {
        return { response: "API Key de Gemini no encontrada. Por favor configura tu archivo .env." };
    }

    const today = moment().format('YYYY-MM-DD');
    const tomorrow = moment().add(1, 'day').format('YYYY-MM-DD');

    const prompt = `Actúa como el asistente de una barbería.
    Tu único objetivo es procesar la orden del dueño para bloquear o desbloquear horas.
    
    Fecha de hoy: ${today}
    Fecha de mañana: ${tomorrow}
    Horarios válidos: 09:00 a 22:00 (siempre terminan en :00).
    
    Instrucción del dueño: "${message}"
    
    Si la orden del dueño incluye rangos de horas (ejemplo: de 1 a 3), DEBES crear múltiples objetos individuales por cada hora exacta involucrada (13:00, 14:00, 15:00). NUNCA pongas rangos de hora en la propiedad "time".
    
    DEBES responder estrictamente con un JSON válido, sin texto adicional, usando este formato:
    {
      "actions": [
        {"type": "BLOCK", "date": "YYYY-MM-DD", "time": "HH:00"},
        {"type": "BLOCK", "date": "YYYY-MM-DD", "time": "HH:00"}
      ],
      "message": "Respuesta breve confirmando la acción."
    }
    Si la orden no tiene sentido, devuelve actions vacío pero siempre incluye message.
    NUNCA uses bloques de código (markdown), responde solo con el JSON puro.`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        console.log("Raw API Response:", text);
        
        let cleanText = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in response");
        
        const data = JSON.parse(jsonMatch[0]);
        if (!data.actions) data.actions = [];
        if (!data.message) data.message = "Comando procesado.";
        
        for (const action of data.actions) {
            if (action.type === 'BLOCK' && action.date && action.time) {
                await blockSlot(action.date, action.time);
            } else if (action.type === 'UNBLOCK' && action.date && action.time) {
                await unblockSlot(action.date, action.time);
            }
        }
        
        return data;
    } catch (err) {
        console.error("AI Output Parse Error:", err);
        return { response: "No pude entender el comando. Por favor especifica el día y la hora exacta (Ej: 'Bloquea mañana a las 3pm')." };
    }
}

module.exports = { processManagerCommand };
