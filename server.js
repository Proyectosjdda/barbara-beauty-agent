process.env.TZ = 'America/Bogota';
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { getDaySchedule, blockSlot, unblockSlot, initDb, cancelAppointment, updateAppointment, getRangeSchedule } = require('./database');
const { processManagerCommand } = require('./managerService');
const { startBot } = require('./bot');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Get schedule
app.get('/api/schedule', async (req, res) => {
    try {
        const { date, start, end } = req.query;
        let schedule;
        if (start && end) {
            schedule = await getRangeSchedule(start.split('T')[0], end.split('T')[0]);
        } else {
            const singleDate = date || new Date().toISOString().split('T')[0];
            schedule = await getDaySchedule(singleDate);
        }
        res.json(schedule);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Manager Chat
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        const result = await processManagerCommand(message);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Manual block/unblock
app.post('/api/block', async (req, res) => {
    try {
        const { date, time } = req.body;
        await blockSlot(date, time);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/unblock', async (req, res) => {
    try {
        const { date, time } = req.body;
        await unblockSlot(date, time);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cancel-appointment', async (req, res) => {
    try {
        const { date, time } = req.body;
        await cancelAppointment(date, time);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/update-appointment', async (req, res) => {
    try {
        const { date, time, name, phone } = req.body;
        await updateAppointment(date, time, name, phone);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start DB, WhatsApp Bot and Web Server
initDb().then(() => {
    // Start WhatsApp client
    startBot();
    
    // Start Web Server
    app.listen(PORT, () => {
        console.log(`\n============== BARBERBOT DASHBOARD ==============`);
        console.log(`Web Dashboard: http://localhost:${PORT}`);
        console.log(`=================================================\n`);
    });
});
