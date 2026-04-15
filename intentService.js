const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const moment = require('moment');
require('moment/locale/es'); // Ensure Spanish is loaded for days

async function detectActionIntent(message) {
    const msg = message.toLowerCase().trim();
    
    // Strict rules for Barbara Lashista
    const cancelPhrases = ['no voy a poder', 'cancela', 'anular', 'hoy no puedo ir', 'debo cancelar', 'no puedo ir', 'cancelar'];
    const bookPhrases = ['agendar', 'cita', 'citas', 'disponibilidad', 'espacio', 'turno', 'reservar', 'apartar', 'agendame', 'me puedes agendar'];
    
    // ✅ Fast-path: check obvious phrases first (no Gemini call needed)
    if (cancelPhrases.some(p => msg.includes(p))) return { action: 'CANCEL' };
    if (bookPhrases.some(p => msg.includes(p))) return { action: 'BOOK' };

    // If no gemini API, stop here
    if (!process.env.GEMINI_API_KEY) {
        return { action: 'NONE' };
    }

    // Only call Gemini for ambiguous messages that don't match any keyword
    const prompt = `Analiza si el siguiente mensaje de un usuario de WhatsApp a "Barbara Beauty" indica una intención CLARA de agendar (BOOK) o cancelar (CANCEL).
    
    REGLA MUY ESTRICTA: Este es el número personal de Bárbara. El bot NO debe activarse con saludos casuales ("hola", "como vas") ni con agradecimientos ("me encantó el retoque", "qué lindas pestañas"). 
    SÓLO DEBE RESPONDER "BOOK" si mencionan explícitamente verbos o palabras de reserva como: "cita", "citas", "disponibilidad", "agendar", "espacio", "turno", "reservar". Si están agradeciendo un servicio pasado, responde "NONE".
    O si dice cosas como "bebe hoy no puedo ir", "bebe debo cancelar" (CANCEL).
    
    Responde ÚNICAMENTE la palabra "BOOK" si el usuario quiere agendar o pregunta por disponibilidad o servicios.
    Responde ÚNICAMENTE la palabra "CANCEL" si el usuario desea cancelar una cita.
    Responde "NONE" en cualquier otro caso. ¡Si hay duda, responde NONE!
    
    Mensaje: "${message}"`;

    try {
        const result = await model.generateContent(prompt);
        const text = await result.response.text();
        const cleanText = text.trim().toUpperCase();
        if (cleanText.includes("BOOK")) return { action: 'BOOK' };
        if (cleanText.includes("CANCEL")) return { action: 'CANCEL' };
        return { action: 'NONE' };
    } catch (error) {
        console.error("Error detecting intent:", error);
        if (cancelPhrases.some(p => msg.includes(p))) return { action: 'CANCEL' };
        if (bookPhrases.some(k => msg.includes(k))) return { action: 'BOOK' };
        return { action: 'NONE' };
    }
}

async function parseDate(message, referenceDate = new Date().toISOString().split('T')[0]) {
    const msg = message.toLowerCase().trim();
    
    // 1. Manual Fallback for common cases
    const ref = () => moment(referenceDate, 'YYYY-MM-DD').locale('es');
    
    if (msg.includes('pasado mañana') || msg.includes('pasado manana')) return ref().add(2, 'day').format('YYYY-MM-DD');
    if (msg.includes('mañana')) return ref().add(1, 'day').format('YYYY-MM-DD');
    if (msg.includes('hoy')) return ref().format('YYYY-MM-DD');

    // ✅ "X días" / "en X días" → e.g. "10 días", "en 10 días", "en 3 dias"
    const enDiasMatch = msg.match(/(?:en\s+)?(\d+)\s+d[íi]as?/);
    if (enDiasMatch) {
        return ref().add(parseInt(enDiasMatch[1]), 'days').format('YYYY-MM-DD');
    }

    // ✅ "X semanas" / "en X semanas" → e.g. "2 semanas", "en 3 semanas"
    const enSemanasMatch = msg.match(/(?:en\s+)?(\d+)\s+semanas?/);
    if (enSemanasMatch) {
        return ref().add(parseInt(enSemanasMatch[1]), 'weeks').format('YYYY-MM-DD');
    }

    // ✅ "un mes" / "en un mes" → 1 month from today
    if (msg.includes('un mes') || msg.includes('1 mes')) {
        return ref().add(1, 'month').format('YYYY-MM-DD');
    }

    // ✅ "el 5 de abril" / "5 de abril" / "el 24 de enero" / "24 de enero"
    const monthMap = {
        'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
        'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
        'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
    };
    const specificDateMatch = msg.match(/(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
    if (specificDateMatch) {
        const day = parseInt(specificDateMatch[1]);
        const month = monthMap[specificDateMatch[2]];
        const refMoment = ref();
        let targetDate = moment(`${refMoment.year()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, 'YYYY-MM-DD');
        // If the date has already passed this year, roll to next year
        if (targetDate.isBefore(refMoment, 'day')) {
            targetDate = targetDate.add(1, 'year');
        }
        return targetDate.format('YYYY-MM-DD');
    }

    const dayMap = {
        'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
        'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 7
    };
    
    for (const [dayName, dayNum] of Object.entries(dayMap)) {
        if (msg.includes(dayName)) {
            const dayRef = ref();
            let currentDay = dayRef.isoWeekday();
            let diff = dayNum - currentDay;
            if (diff <= 0) diff += 7;
            return dayRef.add(diff, 'days').format('YYYY-MM-DD');
        }
    }

    // 2. AI Parsing (if fallback doesn't simple-catch it)
    const prompt = `Hoy es ${referenceDate}. 
    Analiza el siguiente mensaje de un usuario de WhatsApp y extrae la fecha solicitada para una cita en formato YYYY-MM-DD.
    
    Si el usuario dice "mañana", "pasado mañana", "el viernes", "el lunes de la otra semana", calcula la fecha exacta basándote en la fecha de hoy (${referenceDate}).
    
    Responde ÚNICAMENTE con la fecha en formato YYYY-MM-DD. Si no hay una fecha clara, responde "NONE".
    
    Mensaje: "${message}"`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();
        // More lenient regex to match YYYY-MM-DD within text
        const match = text.match(/\d{4}-\d{2}-\d{2}/);
        if (match) {
            return match[0];
        }
        return null;
    } catch (error) {
        console.error("Error parsing date:", error);
        return null;
    }
}

module.exports = { detectActionIntent, parseDate };
