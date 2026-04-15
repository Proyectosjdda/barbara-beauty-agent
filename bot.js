process.env.TZ = 'America/Bogota';
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const moment = require('moment');
const { detectActionIntent, parseDate } = require('./intentService');
const { initDb, getAvailableSlots, bookSlot, getUpcomingReminders, markReminderSent, cancelAppointment, getUpcomingAppointmentsByWhatsApp } = require('./database');

function getRandomMsg(variations) {
    return variations[Math.floor(Math.random() * variations.length)];
}
const cron = require('node-cron');
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const STORAGE_PATH = process.env.STORAGE_PATH || (fs.existsSync('/data') ? '/data' : __dirname);
const VOUCHER_DIR = path.join(__dirname, 'public', 'vouchers');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_PATH)) {
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
}
if (!fs.existsSync(VOUCHER_DIR)) {
    fs.mkdirSync(VOUCHER_DIR, { recursive: true });
}
const { execSync } = require('child_process');

// Determine the correct path to Chromium installed by the system (Nixpacks/Railway)
let systemChromePath;
try {
    systemChromePath = execSync('which chromium').toString().trim();
    if (!systemChromePath) systemChromePath = execSync('which chromium-browser').toString().trim();
    if (!systemChromePath) systemChromePath = execSync('which google-chrome').toString().trim();
} catch (err) {
    console.log('No system Chrome found, falling back to Puppeteer default.');
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(STORAGE_PATH, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || systemChromePath || undefined,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote'
        ]
    }
});


const sessions = {};
const SESSION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// Helper to format time to AM/PM
function formatTime12h(time24h) {
    return moment(time24h, 'HH:mm').format('hh:mm A');
}

// Session cleanup loop
setInterval(() => {
    const now = Date.now();
    for (const from in sessions) {
        // Dynamic timeouts based on state
        let timeout = SESSION_TIMEOUT_MS;
        if (sessions[from].state === 'CHOOSING_SERVICE') {
            timeout = 5 * 60 * 1000; // 5 minutes
        } else if (sessions[from].state === 'WAITING_PAYMENT_VOUCHER') {
            timeout = 7 * 60 * 1000; // 7 minutes
        }

        if (now - sessions[from].lastInteraction > timeout) {
            console.log(`[WhatsApp] Session timed out for ${from} (State: ${sessions[from].state})`);
            delete sessions[from];
        }
    }
}, 30000); // Check every 30 seconds

// Price mapping for 40% deposit (Placeholders for missing values)
const SERVICE_PRICES = {
    "Soft Brows": 40000,
    "Luxe Lift Brows": 90000,
    "Clean Shape": 20000,
    "Lash Bloom": 100000,
    "Wispy Look": 165000,
    "Kim-K Look": 170000,
    "Comics Look": 170000,
    "Foxy Tech": 145000,
    // Default prices for services without specified values
    "Classic Glow": 120000,
    "Deep Black Lash": 130000,
    "Glam Lash": 150000,
    "Tech Lash W 3D": 140000,
    "Tech Lash W 4D": 145000,
    "Tech Lash YY": 140000,
    "Tech Lash W 5D": 150000,
    "Tech Lash Coffee": 150000,
    "Curva U": 160000,
    "Retoque": 0 
};

client.on('qr', (qr) => {
    console.log('\n=================================================');
    console.log('SCAN THIS QR CODE IN YOUR WHATSAPP APP:');
    console.log('=================================================\n');
    console.log('🚨 IF THE TERMINAL QR IS DISTORTED, CLICK THE LINK BELOW 🚨');
    console.log(`🔗 https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(qr)}`);
    console.log('\n=================================================\n');
    qrcode.generate(qr, { small: true });
    console.log('\n=================================================');
    console.log('Try zooming OUT (Ctrl -) in your browser if the terminal QR looks broken.');
    console.log('=================================================\n');
});

client.on('ready', () => {
    console.log('WhatsApp Bot is READY!');
    startReminderCron();
});

// =====================================================
// 🛡️ ANTI-BAN: Humanized reply with typing indicator
// =====================================================
function randomDelay(minMs, maxMs) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs));
}

async function humanReply(msg, text) {
    const chat = await msg.getChat();
    // Mark as seen first (shows blue ticks)
    await chat.sendSeen();
    // Short "read" pause (1-3 seconds)
    await randomDelay(1000, 3000);
    // Start typing indicator
    await chat.sendStateTyping();
    // Type simulation: 1 to 5 seconds
    const typingMs = Math.floor(Math.random() * (5000 - 1000 + 1)) + 1000;
    await randomDelay(typingMs, typingMs);
    // Stop typing and send the message
    await chat.clearState();
    await msg.reply(text);
}

client.on('message', async (msg) => {
    // Guard: skip null/empty messages (stickers, reactions, etc.) and own messages
    if (!msg.body || msg.fromMe) return;

    const from = msg.from;
    const body = msg.body.trim();

    // Guard: skip if body is empty after trim
    if (!body) return;
    
    // Update or clear session if needed
    if (sessions[from]) {
        sessions[from].lastInteraction = Date.now();
    }
    
    const state = sessions[from] ? sessions[from].state : 'IDLE';

    console.log(`[WhatsApp] Incoming message: "${body}" from ${from} (State: ${state})`);

    try {
        if (state === 'IDLE') {
            const intentRes = await detectActionIntent(body);
            console.log(`[WhatsApp] Action Intent: ${intentRes.action}`);
            
            if (intentRes.action === 'BOOK') {
                sessions[from] = { 
                    state: 'CHOOSING_DATE_INIT',
                    lastInteraction: Date.now()
                };
                await humanReply(msg, getRandomMsg([
                    "¡Hola hermosa! 💖 ¿Qué día te gustaría agendar tu cita? ¿Para hoy u otro día?",
                    "¡Hola nena! ✨ Qué gusto saludarte. ¿Deseas agendar para hoy o prefieres otra fecha?",
                    "¡Hola muñeca! 🌸 Bienvenida a Barbara Beauty. ¿Para qué día quieres tu cita?",
                    "¡Hola linda! 🌷 ¿Buscando quedar divina? Cuéntame, ¿para hoy o qué otro día te sirve?",
                    "¡Hola reina! 🎀 ¡Lista para lucir hermosa! ¿Te agendo para hoy o tienes en mente otro día?"
                ]));
            } else if (intentRes.action === 'CANCEL') {
                sessions[from] = { 
                    state: 'GETTING_CANCEL_PHONE',
                    lastInteraction: Date.now()
                };
                await humanReply(msg, getRandomMsg([
                    "Entiendo hermosa. Para buscar tu cita y cancelarla, por favor envíame el número de celular con el que agendaste (ej: 3001234567) 🌸:",
                    "Claro que sí nena. ¿Me ayudas escribiendo el número de teléfono con el que pediste tu turno para buscarlo? ✨",
                    "Ay no te preocupes princesa, pásame tu número de WhatsApp aquí abajito para buscar y cancelar tu cita en el sistema 💖:",
                    "Vale linda, vamos a buscarla. ¿Qué número de celular usaste para agendar tu cita? 🌷",
                    "Entendido hermosa. Escríbeme tu numerito para poder cancelar la cita por este medio 🎀:"
                ]));
            } else {
                console.log(`[WhatsApp] Message ignored. User wrote: "${body}"`);
            }
        } 
        else if (state === 'GETTING_CANCEL_PHONE') {
            const phone = body.replace(/\D/g, '');
            const upcomingList = await getUpcomingAppointmentsByWhatsApp(phone);
            
            if (upcomingList && upcomingList.length > 0) {
                sessions[from].state = 'CHOOSING_CANCEL_APPT';
                sessions[from].appointments = upcomingList;
                
                if (upcomingList.length === 1) {
                    // Solo hay un turno
                    const appt = upcomingList[0];
                    const dateStr = moment(appt.date).format('DD/MM/YYYY');
                    const timeStr = formatTime12h(appt.time);
                    await humanReply(msg, getRandomMsg([
                        `Veo que tienes un turno agendado para el *${dateStr}* a las *${timeStr}* para *${appt.service}*.\n\n¿Estás súper segura que deseas cancelarlo hermosa?\n1. Sí, cancelar\n2. No, mantener mi cita`,
                        `Encontré un turno linda: es el *${dateStr}* a las *${timeStr}* para *${appt.service}*.\n\n¿Quieres que lo cancelemos?\n1. Sí, cancelar por favor\n2. No, déjalo así`,
                        `¡Listo nena! Tienes cita el *${dateStr}* a las *${timeStr}* (*${appt.service}*).\n\n¿Me confirmas si la cancelamos definitivamente?\n1. Sí\n2. No, me arrepentí`,
                        `Tu cita está para el *${dateStr}* a las *${timeStr}* (*${appt.service}*).\n\n¿Cancelamos hermosa?\n1. Sí, cancela\n2. No, mantengamos el turno`,
                        `Princesa, tienes agendado *${appt.service}* el *${dateStr}* a las *${timeStr}*.\n\n¿Anulamos la reserva?\n1. Sí, anular\n2. No, voy a ir`
                    ]));
                } else {
                    // Hay varios turnos
                    let resp = getRandomMsg([
                        "Tienes estos turnos princesa 💖:\n\n",
                        "Encontré varias citas a tu nombre hermosa ✨:\n\n",
                        "Nena, veo que tienes estas reservas activas 🌸:\n\n",
                        "Mira linda, estos son tus turnos próximos 🌷:\n\n",
                        "¡Tienes varios regalitos en la agenda reina! 🎀:\n\n"
                    ]);
                    upcomingList.forEach((appt, i) => {
                        resp += `${i + 1}. El ${moment(appt.date).format('DD/MM')} a las ${formatTime12h(appt.time)} - ${appt.service}\n`;
                    });
                    resp += `\n¿Cuál de estos deseas cancelar? (Escribe el número, ej: "1". O escribe "8" si no quieres cancelar nada).`;
                    await humanReply(msg, resp);
                }
            } else {
                await humanReply(msg, getRandomMsg([
                    `Ay nena, revisé el sistema y no encuentro ningún turno agendado bajo el número *${phone}*. ¡Si te equivocaste, vuelve a enviarme "cancelar cita"! 🌸`,
                    `Hermosa, no me aparece ninguna reserva con el número *${phone}*. ¿Seguro es ese? Si necesitas intentar de nuevo dime "cancelar" ✨`,
                    `Princesa, el número *${phone}* no tiene citas pendientes ahorita. ¡Cualquier cosita escríbeme para agendar! 💖`,
                    `Linda, parece ser que no hay nada agendado con el celular *${phone}*. ¡Vuelve a pedir cancelar si hay otro número! 🌷`,
                    `¡Hola hermosa! Busqué el *${phone}* y no hay citas futuras. Si la liaste marcando, escríbeme de nuevo porfi 🎀`
                ]));
                delete sessions[from];
            }
        }
        else if (state === 'CHOOSING_CANCEL_APPT') {
            const cleanBody = body.toLowerCase().trim();
            const appointments = sessions[from].appointments;
            
            // Si solo habia un turno usamos el index 0 directo si responden con 1
            if (appointments.length === 1) {
                if (cleanBody === '1' || cleanBody.includes('si')) {
                    const appt = appointments[0];
                    await cancelAppointment(appt.date, appt.time);
                    await humanReply(msg, getRandomMsg([
                        '✅ Listo hermosa, tu turno ha sido cancelado exitosamente. ¡Te esperamos en otra ocasión! 💖',
                        '✅ Ya quedó cancelado princesa. ¡Ojalá nos veamos prontito! ✨',
                        '✅ No hay problema nena, reserva anulada. ¡Cuidate mucho! 🌸',
                        '✅ Perfecto linda, ya eliminé tu cita. Quedo súper atenta a cuando quieras volver 🌷',
                        '✅ Turno cancelado reina. ¡Recuerda que aquí siempre eres bienvenida! 🎀'
                    ]));
                    delete sessions[from];
                } else {
                    await humanReply(msg, getRandomMsg([
                        'Vale linda, mantenemos tu cita tal y como estaba. ¡Nos vemos! 💅',
                        'Súper hermosa, dejamos el turno agendado. ¡Aquí te espero! ✨',
                        '¡Me alegra princesa! Cita confirmada y sin cancelar. Nos vemos 💖',
                        'Entendido nena, no se cancela nada. ¡Ve preparando la mirada! 🌸',
                        'Vale reina, tu espacio sigue 100% asegurado. ¡Qué emoción! 🎀'
                    ]));
                    delete sessions[from];
                }
            } else {
                // Hay multiples turnos, se dio una opcion numérica
                const option = parseInt(cleanBody);
                if (!isNaN(option) && option >= 1 && option <= appointments.length) {
                    const appt = appointments[option - 1];
                    await cancelAppointment(appt.date, appt.time);
                    await humanReply(msg, getRandomMsg([
                        `✅ Listo hermosa, el turno del ${moment(appt.date).format('DD/MM')} a las ${formatTime12h(appt.time)} ha sido cancelado exitosamente. ¡Te esperamos pronto! 💖`,
                        `✅ Ya anulamos tu cita del ${moment(appt.date).format('DD/MM')} nena. ¡Ojalá nos veamos en otra ocasión! ✨`,
                        `✅ Turno cancelado correctamente princesa. ¡Cuidate! 🌸`,
                        `✅ Perfecto linda, ya eliminé esa reserva en específico. Quedo súper atenta 🌷`,
                        `✅ Listo reina. Ese turno quedó completamente liberado. ¡Un abrazo! 🎀`
                    ]));
                    delete sessions[from];
                } else if (cleanBody === '8' || cleanBody.includes('no')) {
                    await humanReply(msg, getRandomMsg([
                        'Vale linda, mantenemos todas tus citas listas. ¡Beso! 💅',
                        'Súper hermosa, no voy a cancelar nada. ¡Aquí te espero! ✨',
                        '¡Princesa! Citas aseguradas sin tocar. Nos vemos pronto 💖',
                        'Entendido nena, no se toca tu agenda. 🌸',
                        'Vale reina, todo sigue igual para consentirte. 🎀'
                    ]));
                    delete sessions[from];
                } else {
                    await humanReply(msg, getRandomMsg([
                        'Ese número no está en la lista nena, dime el número de la cita que quieres cancelar 🌸',
                        'Uy hermosa, no te entendí bien. Responde solo con el numerito del turno que quieres borrar ✨',
                        'Princesa, elige un número de los de arribita porfi para saber cuál borro 💖',
                        'Linda, necesito que me digas el numerito correcto de la cita 🌷',
                        'Reina, porfa confírmame con el número (ej: 1 o 2) de la cita a cancelar 🎀'
                    ]));
                }
            }
        } 
        else if (state === 'CHOOSING_DATE_INIT') {
            const date = await parseDate(body, moment().format('YYYY-MM-DD'));
            if (date) {
                const parsedMoment = moment(date);
                if (parsedMoment.day() === 0) {
                    await humanReply(msg, getRandomMsg([
                        "Ay hermosa, los domingos descansamos ✨. ¿Te gustaría agendar para el lunes o cualquier otro día?",
                        "Princesa, los domingos no laboramos 🌸. Dime qué otro día de la semana te sirve para dejarte divina.",
                        "Linda, los domingos cerramos para descansar 💖. ¿Buscamos un huequito el sábado o el lunes?",
                        "Reina, los domingos no atendemos 🌷. Porfa dime otro día que te quede súper bien.",
                        "Nena, el domingo es nuestro día libre 🎀. Pero el lunes arrancamos con toda, ¿te agendo para otro día?"
                    ]));
                    return;
                }
                
                const formattedDate = parsedMoment.format('DD/MM/YYYY');
                const dayName = parsedMoment.locale('es').format('dddd');
                sessions[from].state = 'CONFIRMING_DATE';
                sessions[from].tempDate = date;
                await humanReply(msg, getRandomMsg([
                    `¿Me confirmas que es para el ${dayName} ${formattedDate}, hermosa?\n1. Sí\n2. No`,
                    `¡Súper! Entonces, ¿buscamos espacio para el ${dayName} ${formattedDate} nena?\n1. ¡Sí!\n2. No, me equivoqué`,
                    `Princesa, para estar segura: sería para el ${dayName} ${formattedDate}, ¿verdad?\n1. Sí total\n2. No, otro día`,
                    `Linda, confirmando... ¿para el ${dayName} ${formattedDate}?\n1. Sí es para ese día\n2. No reina`,
                    `Para el ${dayName} ${formattedDate}... ¿está todo en orden hermosa?\n1. Sí\n2. Cámbiame el día`
                ]));
            } else {
                await humanReply(msg, getRandomMsg([
                    'No te entendí bien hermosa, ¿me dices qué día exactamente? (ej: "hoy", "mañana", "el viernes") 🌸',
                    'Uy nena qué pena no logré entenderte. ¿Será para hoy, mañana o pasado? ✨',
                    'Ay princesa, explícamelo un poco más claro. ¿Cuándo quieres venir? 💖',
                    'Linda, dime el día más facilito (por ejemplo "lunes", o "hoy") para encontrarte espacio 🌷',
                    'Reina, no agarré bien el día. ¿Me lo puedes repetir bien claro? 🎀'
                ]));
            }
        }
        else if (state === 'CONFIRMING_DATE') {
            const cleanBody = body.toLowerCase().trim();
            if (cleanBody === '1' || cleanBody.includes('si')) {
                sessions[from].state = 'CHOOSING_FLOW_TYPE';
                await humanReply(msg, getRandomMsg([
                    `¡Perfecto hermosa! Antes de ver los servicios, cuéntame:\n\n1. Es mi Montura por Primera Vez ✨\n2. Es un Retoque 🌸`,
                    `¡Anotado nena! ¿Deseas agendar:\n\n1. Montura Primera Vez\n2. Un Retoque del servicio?`,
                    `¡Listo princesa! Ayúdame con esto porfi:\n\n1. Voy por primera vez\n2. Ya tengo el servicio y vengo a retoque`
                ]));
            } else {
                sessions[from].state = 'CHOOSING_DATE_INIT';
                await humanReply(msg, getRandomMsg([
                    'Vale nena, ¿entonces para qué día te gustaría agendar? ✨',
                    'No pasa nada hermosa. Dime qué otra fechita te sirve 🌸',
                    'Entendido princesa. Pásame el día que realmente quieres para buscar lugar 💖',
                    'Tranquila linda, entonces dime qué otro día y revisamos si hay huequito 🌷',
                    'Vale reina. Volvamos a intentar. ¿Para cuándo te gustaría la cita? 🎀'
                ]));
            }
        }
        else if (state === 'CHOOSING_FLOW_TYPE') {
            const cleanBody = body.toLowerCase().trim();
            if (cleanBody === '1' || cleanBody.includes('primera')) {
                sessions[from].flowType = 'PRIMERA_VEZ';
                sessions[from].state = 'CHOOSING_SERVICE';
                await humanReply(msg, "¡Qué emoción nena! Como es tu primera vez, ¿qué servicio deseas realizarte? ✨\n\n1. Ver catálogo de servicios 📄\n2. Diseño de Cejas ✒️\n3. Extensiones de Pestañas 👁️\n4. Pestañas Tecnológicas 🧬\n5. Efectos Especiales 🎀");
            } else if (cleanBody === '2' || cleanBody.includes('retoque')) {
                sessions[from].flowType = 'RETOQUE';
                sessions[from].state = 'CHOOSING_SERVICE';
                await humanReply(msg, "¿Súper! ¿Un retoque de cuál servicio te vas a realizar hermosa? 🌸\n\n1. Ver catálogo de servicios 📄\n2. Diseño de Cejas ✒️\n3. Extensiones de Pestañas 👁️\n4. Pestañas Tecnológicas 🧬\n5. Efectos Especiales 🎀");
            } else {
                await humanReply(msg, "Por favor elige 1 o 2 hermosa ✨");
            }
        }
        else if (state === 'CHOOSING_SERVICE') {
            const option = parseInt(body);
            const isRetoque = sessions[from].flowType === 'RETOQUE';
            
            if (option === 1) {
                // User wants to see the catalog
                try {
                    const catalogPath = path.join(__dirname, 'public', 'catalogo.pdf');
                    if (fs.existsSync(catalogPath)) {
                        // ✅ ANTI-BAN: Read pause before sending file
                        const chat = await msg.getChat();
                        await chat.sendSeen();
                        await randomDelay(1500, 3500);
                        await chat.sendStateTyping();
                        await randomDelay(2000, 4000);
                        await chat.clearState();

                        const media = MessageMedia.fromFilePath(catalogPath);
                        await client.sendMessage(from, media, { caption: 'Aquí tienes nuestro catálogo de servicios hermosa ✨' });

                        // ✅ ANTI-BAN: Pause between PDF and the follow-up text message
                        await randomDelay(3000, 6000);
                        await humanReply(msg, `¿Y bien nena? ¿Cuál de estas categorías te interesa ahora? ${isRetoque ? '(Retoque)' : ''}\n\n1. Ver catálogo de servicios 📄\n2. Diseño de Cejas ✒️\n3. Extensiones de Pestañas 👁️\n4. Pestañas Tecnológicas 🧬\n5. Efectos Especiales 🎀`);
                    } else {
                        await humanReply(msg, "Ay nena, no pude encontrar el catálogo en este momento.");
                    }
                } catch (err) {
                    console.error("Error sending catalog:", err);
                    await humanReply(msg, "Hubo un problemita enviando el archivo nena, pero dime qué categoría te interesa 🌸");
                }
            } else if (option === 2) {
                sessions[from].state = 'CHOOSING_SUB_SERVICE';
                sessions[from].category = 'CEJAS';
                await humanReply(msg, `Perfecto, ¿qué diseño de cejas ${isRetoque ? '(Retoque)' : ''} te gustaría? ✨:\n\n1️⃣ Soft Brows (diseño + pigmentación)\n2️⃣ Luxe Lift Brows (laminado)\n3️⃣ Clean Shape (solo diseño)\n\nResponde con el numerito hermosa 💖`);
            } else if (option === 3) {
                sessions[from].state = 'CHOOSING_SUB_SERVICE';
                sessions[from].category = 'EXTENSIONES';
                await humanReply(msg, `¡Me encanta esa opción! ¿Qué estilo de extensiones ${isRetoque ? '(Retoque)' : ''} prefieres? 👁️:\n\n1️⃣ Lash Bloom (lifting)\n2️⃣ Classic Glow (natural)\n3️⃣ Deep Black Lash (efecto pestañina)\n4️⃣ Glam Lash (volumen ruso)\n\nDime el número princesa ✨`);
            } else if (option === 4) {
                sessions[from].state = 'CHOOSING_SUB_SERVICE';
                sessions[from].category = 'TECNOLOGICAS';
                await humanReply(msg, `¡Lo último en tendencia! ¿Cuál te gustaría hoy ${isRetoque ? '(Retoque)' : ''}? 🧬:\n\n1️⃣ Tech Lash W 3D\n2️⃣ Tech Lash W 4D\n3️⃣ Tech Lash YY\n4️⃣ Tech Lash W 5D\n5️⃣ Tech Lash Coffee\n6️⃣ Curva U (U-Sharp Fan)\n\nMándame tu número favorito 🌷`);
            } else if (option === 5) {
                sessions[from].state = 'CHOOSING_SUB_SERVICE';
                sessions[from].category = 'EFECTOS';
                await humanReply(msg, `¡Para lucir espectacular! ¿Qué efecto especial ${isRetoque ? '(Retoque)' : ''} quieres? 🎀:\n\n1️⃣ Wispy Look\n2️⃣ Kim-K Look\n3️⃣ Comics Look\n4️⃣ Foxy Tech\n\nElige con el numerito reina ✨`);
            } else {
                await humanReply(msg, "Por favor elige una opción del 1 al 5 hermosa 🌸");
            }
        }
        else if (state === 'CHOOSING_SUB_SERVICE') {
            const option = parseInt(body);
            const category = sessions[from].category;
            let selectedService = "";

            if (category === 'CEJAS') {
                const options = ["Soft Brows", "Luxe Lift Brows", "Clean Shape"];
                if (option >= 1 && option <= 3) selectedService = options[option - 1];
            } else if (category === 'EXTENSIONES') {
                const options = ["Lash Bloom", "Classic Glow", "Deep Black Lash", "Glam Lash"];
                if (option >= 1 && option <= 4) selectedService = options[option - 1];
            } else if (category === 'TECNOLOGICAS') {
                const options = ["Tech Lash W 3D", "Tech Lash W 4D", "Tech Lash YY", "Tech Lash W 5D", "Tech Lash Coffee", "Curva U"];
                if (option >= 1 && option <= 6) selectedService = options[option - 1];
            } else if (category === 'EFECTOS') {
                const options = ["Wispy Look", "Kim-K Look", "Comics Look", "Foxy Tech"];
                if (option >= 1 && option <= 4) selectedService = options[option - 1];
            }

            if (selectedService) {
                sessions[from].service = selectedService;
                
                if (sessions[from].flowType === 'PRIMERA_VEZ') {
                    const price = SERVICE_PRICES[selectedService] || 0;
                    const deposit = Math.round(price * 0.4);
                    const depositText = price > 0 ? `*SE DEBE CANCELAR EL 40% DEL VALOR DEL SERVICIO ($${deposit.toLocaleString()}) ESTO ANTES DE LA CITA PARA PODER AGENDARTE!*` : `*SE DEBE CANCELAR EL 40% DEL VALOR DEL SERVICIO ESTO ANTES DE LA CITA PARA PODER AGENDARTE!*`;
                    
                    sessions[from].state = 'WAITING_PAYMENT_VOUCHER';
                    await humanReply(msg, `¡Excelente elección nena! 💖 Para asegurar tu primera cita, tenemos esta política de reserva:\n\n${depositText}\n\n*ESTAS SON LAS OPCIONES DE PAGO*\n\n*Bancolombia*\nBárbara Silva\nCuenta Ahorros\n07800002953\n\n*Nequi*\nBárbara Silva\n3150640169\n\n*Llaves de Nu*\n@BSS279\n\n*POR FAVOR ADJUNTA EL SOPORTE DE TRANSFERENCIA AQUÍ ABAJO* ✨\n(Tienes 7 minutos para enviarlo antes de que se cierre el turno)`);
                } else {
                    // Retoque: direct to slots
                    await startChoosingSlot(msg, from, sessions[from].tempDate);
                }
            } else {
                await humanReply(msg, "Esa opción no es válida nena, por favor elige un número de la lista que te mandé arribita 🌸");
            }
        }
        else if (state === 'WAITING_PAYMENT_VOUCHER') {
            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    if (media) {
                        const filename = `voucher_${from.split('@')[0]}_${Date.now()}.jpg`;
                        const savePath = path.join(__dirname, 'public', 'vouchers', filename);
                        fs.writeFileSync(savePath, media.data, { encoding: 'base64' });
                        
                        sessions[from].voucherUrl = `/vouchers/${filename}`;
                        await humanReply(msg, "¡Recibido hermosa! ✨ Gracias por enviar el comprobante. Ahora sí, vamos a elegir tu hora preferida:");
                        await startChoosingSlot(msg, from, sessions[from].tempDate);
                    }
                } catch (err) {
                    console.error("Error downloading voucher:", err);
                    await humanReply(msg, "Hubo un problemita guardando la imagen nena, ¿podrías enviarla de nuevo porfa? 🌸");
                }
            } else {
                await humanReply(msg, "Por favor hermosa, *envía el soporte de transferencia en una foto* para poder continuar con tu agendamiento 💖. Sin el comprobante no puedo separar tu cupo.");
            }
        }
        else if (state === 'CHOOSING_SLOT') {
            const index = parseInt(body) - 1;
            const slots = sessions[from].slots;

            if (isNaN(index) || index < 0 || index >= slots.length) {
                await humanReply(msg, getRandomMsg([
                    'Ese numerito no está en la lista nena, intenta de nuevo porfa. 🌸',
                    'Hermosa, no veo la hora con ese número. Escoge de los que te mandé arribita ✨',
                    'Princesa, ¿segura que mandaste el número correcto? Inténtalo otra vez 💖',
                    'Linda, elige con el número que sale al lado de la hora para agarrarte el puesto 🌷',
                    'Uy reina, casi. Escríbeme el numerito que está junto a la hora disponible 🎀'
                ]));
            } else {
                const selectedTime = slots[index];
                sessions[from].state = 'GETTING_NAME';
                sessions[from].time = selectedTime;
                await humanReply(msg, getRandomMsg([
                    '¡Súper! ¿A qué nombre agendamos la cita hermosa? ✨',
                    '¡Genial! Regálame tu nombrecito y apellido para asegurar tu agenda nena 🌸',
                    '¡Qué bien princesa! ¿Cómo te llamas para dejarlo guardadito? 💖',
                    'Perfecto linda. Dime tu nombre completo para el sistema porfi 🌷',
                    '¡Ya casi reina! Escríbeme tu nombre para ponerte en el calendario 🎀'
                ]));
            }
        } 
        else if (state === 'GETTING_NAME') {
            sessions[from].name = body;
            sessions[from].state = 'GETTING_PHONE';
            await humanReply(msg, getRandomMsg([
                `Un gusto ${body} ✨. Ahora regálame tu número de celular para enviarte la confirmación:`,
                `Súper ${body} 🌸. Por fa regálame tu número de teléfono para dejarte lista en la agenda:`,
                `Ay princesa ${body} 💖. Déjame tu numerito de celu aquí para enviarte recordatorios luego:`,
                `Listo linda ${body} 🌷. Para confirmar tu asistencia, dime tu número telefónico:`,
                `Encantada de atenderte ${body} 🎀. Cierra con broche de oro regalándome tu número de WhatsApp aquí abajo:`
            ]));
        }
        else if (state === 'GETTING_PHONE') {
            const rawPhone = body.replace(/\D/g, '');
            if (rawPhone.length < 7) {
                await humanReply(msg, getRandomMsg([
                    'Ese número parece faltarle dígitos nena, revísalo y escríbelo de nuevo porfa 🌸:',
                    'Ay hermosa, ese número se ve cortito. ¿Me lo pasas de nuevo con todos los números? ✨:',
                    'Princesa, revisa que no le falte un número a tu celu e intenta otra vez 💖:',
                    'Linda, como que ese no está completico. Escríbelo súper bien por favor 🌷:',
                    'Reina, ¡revisa bien! Parece que digitaste mal el número, mándalo de nuevo 🎀:'
                ]));
            } else {
                sessions[from].extractedPhone = rawPhone;
                sessions[from].state = 'CONFIRMING_PHONE';
                await humanReply(msg, getRandomMsg([
                    `Confírmame si tu número es el *${rawPhone}*:\n\n1. Sí, es correcto\n2. No, lo escribí mal`,
                    `¿Está bien el *${rawPhone}* hermosa?\n\n1. Súper bien\n2. Lo pasé mal`,
                    `Princesa, me diste el *${rawPhone}*, ¿está correcto?\n\n1. Sí\n2. No reina`,
                    `Linda, confirmando tu celu: *${rawPhone}*. ¿Quedó bien?\n\n1. Perfecto\n2. Me equivoqué`,
                    `Reina, veo que mandaste *${rawPhone}*. ¿Seguro que es ese?\n\n1. Totalmente\n2. Fallé en un número`
                ]));
            }
        }
        else if (state === 'CONFIRMING_PHONE') {
            const cleanBody = body.toLowerCase().trim();
            if (cleanBody === '1' || cleanBody.includes('si') || cleanBody.includes('súper bien') || cleanBody.includes('perfecto')) {
                const context = sessions[from];
                const phone = context.extractedPhone;
                const result = await bookSlot(context.name, phone, context.tempDate, context.time, context.service, context.voucherUrl);

                if (result.success) {
                    const timeStr = formatTime12h(context.time);
                    const dateStr = moment(context.tempDate).format('DD/MM/YYYY');
                    await humanReply(msg, getRandomMsg([
                        `¡Listo hermosa! 🎀 Ya quedó confirmada tu cita para realizarte *${context.service}*.\nNos vemos el *${dateStr}* a las *${timeStr}*. ¡Te esperamos! ✨`,
                        `¡Quedaste agendada nena! 🌸 Vamos a hacerte *${context.service}* el *${dateStr}* a la hora acordada (*${timeStr}*). ¡Nos vemos para dejarte bella! 💖`,
                        `¡Súper lista princesa! 👑 Ya salvaste tu campito el *${dateStr}* a las *${timeStr}*. Prepárate para lucir *${context.service}* espectaculares. 💖`,
                        `¡Todo confirmado linda! 🌷 Quedó para el *${dateStr}* a las *${timeStr}* para que te hagas *${context.service}*. Aquí te esperamos ansiosas ✨.`,
                        `¡Agendada exitosamente reina! 🎀 Tu servicio será *${context.service}* y nos veremos el *${dateStr}* a las *${timeStr}*. ¡Un abrazo! 🌸`
                    ]));
                    delete sessions[from];
                } else {
                    await humanReply(msg, getRandomMsg([
                        'Ay hermosa, justo ese horario se acaba de ocupar 😔. Intentemos de nuevo pidiendo disponibilidad.',
                        'Qué mala suerte nena, alguien nos robó ese huequito recién ✨. Escribe de nuevo "citas" para mirar otro lugar.',
                        'Princesa, el sistema acaba de reportar que se bloqueó el campito 💔. Vuelve a decir "agendar" para buscar otro.',
                        'Uy linda, se nos adelantaron por poco. Intenta hacer el proceso otra vez, no tardamos nada 🌸',
                        'Reina, ¡la suerte no alcanzó! Se llenó la hora justico. Escribe para intentarlo otra vez 🎀'
                    ]));
                    delete sessions[from];
                }
            } else {
                sessions[from].state = 'GETTING_PHONE';
                await humanReply(msg, getRandomMsg([
                    'No te preocupes nena, vuelve a escribirme el número correcto: 🌸',
                    '¡Cero estrés hermosa! Escríbelo con calmita de nuevo: ✨',
                    'Princesa, vuélvemelo a pasar bien detalladito abajito: 💖',
                    'Linda, mándame el número nuevamente sin afanes: 🌷',
                    'Tranquila reina, escríbelo por aquí de nuevo: 🎀'
                ]));
            }
        }
    } catch (err) {
        console.error('Error handling WhatsApp message:', err);
    }
});

async function startChoosingSlot(msg, from, date) {
    const slots = await getAvailableSlots(date);
    
    if (slots.length === 0) {
        await humanReply(msg, getRandomMsg([
            `Ay nena, ya no tengo espacios libres para el ${moment(date).format('DD/MM/YYYY')} 😔.`,
            `Hermosa qué pena! Ya estoy súper llena el ${moment(date).format('DD/MM/YYYY')} ✨.`,
            `Princesa, reviso y para el ${moment(date).format('DD/MM/YYYY')} estoy a tope hoy 💔.`,
            `Linda, lastimosamente llené agenda para el ${moment(date).format('DD/MM/YYYY')}. ¡Pregúntame otro día! 🌸`,
            `Reina, para el ${moment(date).format('DD/MM/YYYY')} ya cayeron todas las citas. ¿Miramos otro día? 🎀`
        ]));
        delete sessions[from];
    } else {
        let response = getRandomMsg([
            `Escoge una horita de las disponibles para el ${moment(date).format('DD/MM/YYYY')} hermosa:\n\n`,
            `Mira los espacios bellos que tengo para el ${moment(date).format('DD/MM/YYYY')} nena:\n\n`,
            `Estas son las horas en que te puedo consentir el ${moment(date).format('DD/MM/YYYY')} princesa:\n\n`,
            `Aquí tienes los horitas del ${moment(date).format('DD/MM/YYYY')} linda, me avisas cuál cuadra:\n\n`,
            `Elije con un número el campito que desees el ${moment(date).format('DD/MM/YYYY')} reina:\n\n`
        ]);
        slots.forEach((s, i) => {
            response += `${i + 1}. ${formatTime12h(s)}\n`;
        });
        sessions[from].state = 'CHOOSING_SLOT';
        sessions[from].slots = slots;
        await humanReply(msg, response);
    }
}

function startReminderCron() {
    console.log('[Cron] Reminder cron job started. Checking every 15 minutes (Mon–Sat, 7AM–5PM).');
    // ✅ COST OPTIMIZATION: Cron fires only during reminder-relevant hours:
    // - Wakes at 7:00 AM to catch the 8:00 AM appointment (first slot)
    // - Last reminder needed at 5PM for the 6PM appointment (last slot)
    // - Dormant every night and all day Sunday → minimum Railway compute cost
    cron.schedule('5,20,35,50 7-17 * * 1-6', async () => {
        const now = moment();

        console.log('[Cron] Running reminder check...');
        try {
            const reminders = await getUpcomingReminders();
            console.log(`[Cron] Found ${reminders.length} reminder(s) to send.`);
            for (const rem of reminders) {
                const timeStr = formatTime12h(rem.time);
                
                const aptMoment = moment(`${rem.date} ${rem.time}`, 'YYYY-MM-DD HH:mm');
                const minsLeft = aptMoment.diff(moment(), 'minutes');
                let timeText = `en *${minsLeft} minutos*`;
                if (minsLeft >= 50) {
                    timeText = `en aproximadamente *1 hora*`;
                }
                
                const message = `¡Hola hermosa ${rem.name}! 🎀 Recuerda que tienes tu cita en Barbara Beauty ${timeText} a las *${timeStr}* para realizarte *${rem.service}*. ¡Te espero lista para dejarte divina! ✨`;
                
                // Normalize the phone: remove spaces, dashes and ensure country code
                let phone = rem.phone.replace(/[\s\-()]/g, '');
                if (phone.startsWith('0')) phone = phone.substring(1);
                if (!phone.startsWith('57') && phone.length === 10) phone = '57' + phone;
                
                const whatsappId = `${phone}@c.us`;
                console.log(`[Cron] Sending reminder to ${whatsappId} for ${rem.name}`);
                await client.sendMessage(whatsappId, message);
                // Mark as sent so we don't send it again
                await markReminderSent(rem.id);
                // ✅ ANTI-BAN: Random delay between each reminder (4–10 seconds)
                // Prevents sending multiple reminders back-to-back which looks like bulk spam
                await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 6000) + 4000));
            }
        } catch (err) {
            console.error('[Cron] Error in reminder cron:', err);
        }
    });
}

function startBot() {
    client.initialize().catch(err => {
        console.error('=================================================');
        console.error('FAILED TO INITIALIZE WHATSAPP CLIENT');
        console.error(err);
        console.error('=================================================');
    });
}

module.exports = { startBot };
