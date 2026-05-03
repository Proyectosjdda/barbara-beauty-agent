const fs = require('fs');

let content = fs.readFileSync('bot.js', 'utf8');

const targetBlock = `        else if (state === 'CHOOSING_CANCEL_APPT') {
            const cleanBody = body.toLowerCase().trim();
            const appointments = sessions[from].appointments;
            
            // Si solo habia un turno usamos el index 0 directo si responden con 1
            if (appointments.length === 1) {
                if (cleanBody === '1' || cleanBody.includes('si')) {
                    const appt = appointments[0];
                    await cancelAppointment(appt.date, appt.time);
                    await humanReply(msg, getRandomMsg([
                        '✅ Listo, tu turno ha sido cancelado exitosamente. ¡Te esperamos en otra ocasión! 💖',
                        '✅ Ya quedó cancelado. ¡Ojalá nos veamos prontito! ✨',
                        '✅ No hay problema, reserva anulada. ¡Cuidate mucho! 🌸',
                        '✅ Perfecto, ya eliminé tu cita. Quedo súper atenta a cuando quieras volver 🌷',
                        '✅ Turno cancelado. ¡Recuerda que aquí siempre eres bienvenida! 🎀'
                    ]));
                    delete sessions[from];
                } else {
                    await humanReply(msg, getRandomMsg([
                        'Vale, mantenemos tu cita tal y como estaba. ¡Nos vemos! 💅',
                        'Súper, dejamos el turno agendado. ¡Aquí te espero! ✨',
                        '¡Me alegra! Cita confirmada y sin cancelar. Nos vemos 💖',
                        'Entendido, no se cancela nada. ¡Ve preparando la mirada! 🌸',
                        'Vale, tu espacio sigue 100% asegurado. ¡Qué emoción! 🎀'
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
                        \`✅ Listo, el turno del \${moment(appt.date).format('DD/MM')} a las \${formatTime12h(appt.time)} ha sido cancelado exitosamente. ¡Te esperamos pronto! 💖\`,
                        \`✅ Ya anulamos tu cita del \${moment(appt.date).format('DD/MM')}. ¡Ojalá nos veamos en otra ocasión! ✨\`,
                        \`✅ Turno cancelado correctamente. ¡Cuidate! 🌸\`,
                        \`✅ Perfecto, ya eliminé esa reserva en específico. Quedo súper atenta 🌷\`,
                        \`✅ Listo. Ese turno quedó completamente liberado. ¡Un abrazo! 🎀\`
                    ]));
                    delete sessions[from];
                } else if (cleanBody === '8' || cleanBody.includes('no')) {
                    await humanReply(msg, getRandomMsg([
                        'Vale, mantenemos todas tus citas listas. ¡Beso! 💅',
                        'Súper, no voy a cancelar nada. ¡Aquí te espero! ✨',
                        '¡Excelente! Citas aseguradas sin tocar. Nos vemos pronto 💖',
                        'Entendido, no se toca tu agenda. 🌸',
                        'Vale, todo sigue igual para consentirte. 🎀'
                    ]));
                    delete sessions[from];
                } else {
                    await humanReply(msg, getRandomMsg([
                        'Ese número no está en la lista, dime el número de la cita que quieres cancelar 🌸',
                        'Disculpa, no te entendí bien. Responde solo con el numerito del turno que quieres borrar ✨',
                        'Casi, pero no. Elige usando solo el número de las opciones que te di 💖'
                    ]));
                }
            }
        }`;

const newBlock = `        else if (state === 'CHOOSING_CANCEL_APPT') {
            const cleanBody = body.toLowerCase().trim();
            const appointments = sessions[from].appointments;
            
            const processCancel = async (appt) => {
                const aptMoment = moment(\`\${appt.date} \${appt.time}\`, 'YYYY-MM-DD HH:mm');
                const hoursLeft = aptMoment.diff(moment(), 'hours');
                
                if (hoursLeft < 24) {
                    sessions[from].state = 'CONFIRMING_LATE_CANCEL';
                    sessions[from].pendingCancelAppt = appt;
                    await humanReply(msg, "⚠️ *Aviso de Políticas*\\n\\nPor políticas del estudio, si cancelas con menos de 24 horas de anticipación perderás tu abono.\\n\\n¿Deseas continuar con la cancelación?\\n\\n1. Sí, cancelar cita\\n2. No, mantener cita");
                } else {
                    await cancelAppointment(appt.date, appt.time);
                    await humanReply(msg, getRandomMsg([
                        \`✅ Listo, el turno del \${moment(appt.date).format('DD/MM')} a las \${formatTime12h(appt.time)} ha sido cancelado exitosamente. ¡Te esperamos pronto! 💖\`,
                        \`✅ Ya anulamos tu cita del \${moment(appt.date).format('DD/MM')}. ¡Ojalá nos veamos en otra ocasión! ✨\`,
                        \`✅ Turno cancelado correctamente. ¡Cuidate! 🌸\`,
                        \`✅ Perfecto, ya eliminé esa reserva en específico. Quedo súper atenta 🌷\`,
                        \`✅ Listo. Ese turno quedó completamente liberado. ¡Un abrazo! 🎀\`
                    ]));
                    delete sessions[from];
                }
            };

            // Si solo habia un turno usamos el index 0 directo si responden con 1
            if (appointments.length === 1) {
                if (cleanBody === '1' || cleanBody.includes('si')) {
                    await processCancel(appointments[0]);
                } else {
                    await humanReply(msg, getRandomMsg([
                        'Vale, mantenemos tu cita tal y como estaba. ¡Nos vemos! 💅',
                        'Súper, dejamos el turno agendado. ¡Aquí te espero! ✨',
                        '¡Me alegra! Cita confirmada y sin cancelar. Nos vemos 💖',
                        'Entendido, no se cancela nada. ¡Ve preparando la mirada! 🌸',
                        'Vale, tu espacio sigue 100% asegurado. ¡Qué emoción! 🎀'
                    ]));
                    delete sessions[from];
                }
            } else {
                // Hay multiples turnos, se dio una opcion numérica
                const option = parseInt(cleanBody);
                if (!isNaN(option) && option >= 1 && option <= appointments.length) {
                    await processCancel(appointments[option - 1]);
                } else if (cleanBody === '8' || cleanBody.includes('no')) {
                    await humanReply(msg, getRandomMsg([
                        'Vale, mantenemos todas tus citas listas. ¡Beso! 💅',
                        'Súper, no voy a cancelar nada. ¡Aquí te espero! ✨',
                        '¡Excelente! Citas aseguradas sin tocar. Nos vemos pronto 💖',
                        'Entendido, no se toca tu agenda. 🌸',
                        'Vale, todo sigue igual para consentirte. 🎀'
                    ]));
                    delete sessions[from];
                } else {
                    await humanReply(msg, getRandomMsg([
                        'Ese número no está en la lista, dime el número de la cita que quieres cancelar 🌸',
                        'Disculpa, no te entendí bien. Responde solo con el numerito del turno que quieres borrar ✨',
                        'Casi, pero no. Elige usando solo el número de las opciones que te di 💖'
                    ]));
                }
            }
        }
        else if (state === 'CONFIRMING_LATE_CANCEL') {
            const cleanBody = body.toLowerCase().trim();
            const appt = sessions[from].pendingCancelAppt;
            
            if (cleanBody === '1' || cleanBody.includes('si')) {
                await cancelAppointment(appt.date, appt.time);
                await humanReply(msg, \`✅ Cita cancelada. De acuerdo a nuestras políticas, el abono no será reembolsado. ¡Te esperamos en otra oportunidad! 💖\`);
                delete sessions[from];
            } else {
                await humanReply(msg, \`¡Perfecto! Hemos mantenido tu cita del \${moment(appt.date).format('DD/MM')} a las \${formatTime12h(appt.time)}. ¡Allí nos vemos! ✨\`);
                delete sessions[from];
            }
        }`;

content = content.replace(targetBlock, newBlock);
fs.writeFileSync('bot.js', content);
