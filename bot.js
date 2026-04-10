process.env.TZ = 'America/Bogota';
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const moment = require('moment');
const { detectActionIntent, parseDate } = require('./intentService');
const { initDb, getAvailableSlots, bookSlot, getUpcomingReminders, markReminderSent, cancelAppointment, getUpcomingAppointmentsByWhatsApp } = require('./database');

function getRandomMsg(variations) {
    return variations[Math.floor(Math.random() * variations.length)];
}
const cron = require('node-cron');
require('dotenv').config();

const STORAGE_PATH = process.env.STORAGE_PATH || __dirname;
const path = require('path');
const fs = require('fs');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_PATH)) {
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
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
        if (now - sessions[from].lastInteraction > SESSION_TIMEOUT_MS) {
            console.log(`[WhatsApp] Session timed out for ${from}`);
            delete sessions[from];
        }
    }
}, 30000); // Check every 30 seconds

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
    const from = msg.from;
    const body = msg.body.trim();
    
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
            const phone = body.replace(/\\D/g, '');
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
                sessions[from].state = 'CHOOSING_SERVICE';
                await humanReply(msg, getRandomMsg([
                    `¡Perfecto! ¿Qué servicio deseas realizarte hermosa?\n\n1. Montura Primera Vez\n2. Retoque\n3. Laminado de cejas\n4. Laminado y pestañas\n5. Lifting\n6. Cejas`,
                    `¡Anotado! Cuéntame nena, ¿qué nos vamos a hacer para quedar más bellas?\n\n1. Montura Primera Vez\n2. Retoque\n3. Laminado de cejas\n4. Laminado y pestañas\n5. Lifting\n6. Cejas`,
                    `¡Listo princesa! Ayúdame escogiendo el servicio que buscas:\n\n1. Montura Primera Vez\n2. Retoque\n3. Laminado de cejas\n4. Laminado y pestañas\n5. Lifting\n6. Cejas`,
                    `Super linda. Ahora dime, ¿cuál de estos servicios te gustaría hacerte?\n\n1. Montura Primera Vez\n2. Retoque\n3. Laminado de cejas\n4. Laminado y pestañas\n5. Lifting\n6. Cejas`,
                    `¡Excelente reina! Elige aquí abajito el servicio que te quieres hacer:\n\n1. Montura Primera Vez\n2. Retoque\n3. Laminado de cejas\n4. Laminado y pestañas\n5. Lifting\n6. Cejas`
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
        else if (state === 'CHOOSING_SERVICE') {
            const option = parseInt(body);
            const services = ["Montura Primera Vez", "Retoque", "Laminado de cejas", "Laminado y pestañas", "Lifting", "Cejas"];
            if (option >= 1 && option <= 6) {
                sessions[from].service = services[option - 1];
                await startChoosingSlot(msg, from, sessions[from].tempDate);
            } else {
                await humanReply(msg, getRandomMsg([
                    'Por favor elige un numerito del 1 al 6 hermosa 🌸',
                    'Uy nena, ese numerito no es. Envíame sólo el número entre el 1 y el 6 ✨',
                    'Princesa, elige con el número de la lista para que sea más fácil 💖',
                    'Linda, ese no lo encuentro. Escribe un número válido (1-6) 🌷',
                    'Hermosa, márcame con el número del 1 al 6 qué te quieres hacer 🎀'
                ]));
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
            const rawPhone = body.replace(/\\D/g, ''); 
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
                const result = await bookSlot(context.name, phone, context.tempDate, context.time, context.service);

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
    console.log('[Cron] Reminder cron job started. Checking every 15 minutes.');
    // Run every 15 minutes to save ticks
    cron.schedule('*/15 * * * *', async () => {
        const now = moment();
        const currentHour = now.hour();
        const currentDay = now.day();

        // No evaluar recordatorios los domingos
        if (currentDay === 0) return;

        // Después de las 10 PM (22) y antes de las 7 AM (7), validar solo cada 3 horas para "ahorrar" pings
        if (currentHour >= 22 || currentHour < 7) {
            // Solo correr a las 22:00, 1:00 y 4:00 (módulo 3) y restringir a los minutos 0
            if (now.minute() > 14 || (currentHour % 3 !== 1 && currentHour !== 22 && currentHour !== 4)) {
                return;
            }
        }

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
