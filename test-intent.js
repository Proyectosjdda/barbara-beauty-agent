const { detectIntent } = require('./intentService');

async function test() {
    console.log('Testing "hola"...');
    console.log(await detectIntent('hola'));
    
    console.log('Testing "Quiero un turno"...');
    console.log(await detectIntent('Quiero un turno'));
    
    console.log('Testing "Agendar cita"...');
    console.log(await detectIntent('Agendar cita'));
}

test().catch(console.error);
