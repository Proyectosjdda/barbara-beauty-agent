const fs = require('fs');
let code = fs.readFileSync('bot.js', 'utf8');

const targetContent = `            // Si solo habia un turno usamos el index 0 directo si responden con 1
            if (appointments.length === 1) {`;

const newContent = `            // Helper function to check 24h rule and cancel
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
            if (appointments.length === 1) {`;

code = code.replace(targetContent, newContent);

// Replace the manual await cancelAppointments inside the if/else with processCancel
code = code.replace(/const appt = appointments\[0\];\n\s+await cancelAppointment\(appt\.date, appt\.time\);\n\s+await humanReply\(msg, getRandomMsg\(\[([\s\S]*?)\]\)\);\n\s+delete sessions\[from\];/g, 'await processCancel(appointments[0]);');

code = code.replace(/const appt = appointments\[option - 1\];\n\s+await cancelAppointment\(appt\.date, appt\.time\);\n\s+await humanReply\(msg, getRandomMsg\(\[([\s\S]*?)\]\)\);\n\s+delete sessions\[from\];/g, 'await processCancel(appointments[option - 1]);');

// Add CONFIRMING_LATE_CANCEL at the end of the state chain
code = code.replace(/    \/\/ =====================================================\n    \/\/ 🛡️ ANTI-BAN:/g, 
`        else if (state === 'CONFIRMING_LATE_CANCEL') {
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
        }
    // =====================================================
    // 🛡️ ANTI-BAN:`);

fs.writeFileSync('bot.js', code);
console.log('Done');
