const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const moment = require('moment');

const fs = require('fs');
const STORAGE_PATH = process.env.STORAGE_PATH || (fs.existsSync('/data') ? '/data' : __dirname);
const DB_PATH = path.join(STORAGE_PATH, 'barber.db');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_PATH)) {
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

function initDb() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Table for appointments
            db.run(`CREATE TABLE IF NOT EXISTS appointments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                phone TEXT,
                date TEXT,
                time TEXT,
                service TEXT,
                status TEXT DEFAULT 'CONFIRMED',
                reminder_sent INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Add reminder_sent and service columns to existing tables (migration)
            db.run(`ALTER TABLE appointments ADD COLUMN reminder_sent INTEGER DEFAULT 0`, () => {});
            db.run(`ALTER TABLE appointments ADD COLUMN service TEXT`, () => {});
            db.run(`ALTER TABLE appointments ADD COLUMN voucher_url TEXT`, () => {});

            // Table for availability slots
            // is_occupied: 0 = Free, 1 = Booked, 2 = Blocked by Manager
            db.run(`CREATE TABLE IF NOT EXISTS availability (
                date TEXT,
                time TEXT,
                is_occupied INTEGER DEFAULT 0,
                PRIMARY KEY (date, time)
            )`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

const WORKING_HOURS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'];

async function ensureSlotsExist(date) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            const stmt = db.prepare("INSERT OR IGNORE INTO availability (date, time, is_occupied) VALUES (?, ?, 0)");
            WORKING_HOURS.forEach(slot => stmt.run(date, slot));
            stmt.finalize((err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function getAvailableSlots(date) {
    return new Promise(async (resolve, reject) => {
        await ensureSlotsExist(date);
        db.all("SELECT time FROM availability WHERE date = ? AND is_occupied = 0", [date], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.time));
        });
    });
}

function bookSlot(name, phone, date, time, service, voucher_url = null) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.get("SELECT is_occupied FROM availability WHERE date = ? AND time = ?", [date, time], (err, row) => {
                if (err) return reject(err);
                if (!row || row.is_occupied !== 0) {
                    return resolve({ success: false, message: 'El horario ya no está disponible.' });
                }

                db.run("BEGIN TRANSACTION");
                db.run("UPDATE availability SET is_occupied = 1 WHERE date = ? AND time = ?", [date, time]);
                db.run("INSERT INTO appointments (name, phone, date, time, service, voucher_url) VALUES (?, ?, ?, ?, ?, ?)", [name, phone, date, time, service, voucher_url]);
                db.run("COMMIT", (err) => {
                    if (err) {
                        db.run("ROLLBACK");
                        reject(err);
                    } else {
                        resolve({ success: true });
                    }
                });
            });
        });
    });
}

function blockSlot(date, time) {
    return new Promise(async (resolve, reject) => {
        await ensureSlotsExist(date);
        db.run("UPDATE availability SET is_occupied = 2 WHERE date = ? AND time = ?", [date, time], (err) => {
            if (err) reject(err);
            else resolve({ success: true });
        });
    });
}

function unblockSlot(date, time) {
    return new Promise(async (resolve, reject) => {
        await ensureSlotsExist(date);
        db.run("UPDATE availability SET is_occupied = 0 WHERE date = ? AND time = ?", [date, time], (err) => {
            if (err) reject(err);
            else resolve({ success: true });
        });
    });
}

function getAllAppointments() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM appointments ORDER BY date, time", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getDaySchedule(date) {
    return new Promise(async (resolve, reject) => {
        await ensureSlotsExist(date);
        db.all(`
            SELECT a.time, a.is_occupied, app.name, app.phone, app.service, app.voucher_url 
            FROM availability a
            LEFT JOIN appointments app ON a.date = app.date AND a.time = app.time
            WHERE a.date = ?
            ORDER BY a.time
        `, [date], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getUpcomingReminders() {
    return new Promise((resolve, reject) => {
        const now = moment();
        const today = now.format('YYYY-MM-DD');

        // Find appointments happening within the next 5 to 65 minutes
        // (window catches any slot that falls in the "about 1 hour from now" range)
        const windowStart = now.clone().add(5, 'minutes').format('HH:mm');
        const windowEnd   = now.clone().add(65, 'minutes').format('HH:mm');

        db.all(
            `SELECT * FROM appointments
             WHERE date = ?
               AND time BETWEEN ? AND ?
               AND status = 'CONFIRMED'
               AND reminder_sent = 0`,
            [today, windowStart, windowEnd],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

function markReminderSent(id) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE appointments SET reminder_sent = 1 WHERE id = ?", [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function cancelAppointment(date, time) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run("UPDATE availability SET is_occupied = 0 WHERE date = ? AND time = ?", [date, time]);
            db.run("DELETE FROM appointments WHERE date = ? AND time = ?", [date, time]);
            db.run("COMMIT", (err) => {
                if (err) {
                    db.run("ROLLBACK");
                    reject(err);
                } else {
                    resolve({ success: true });
                }
            });
        });
    });
}

function updateAppointment(date, time, name, phone) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE appointments SET name = ?, phone = ? WHERE date = ? AND time = ?", [name, phone, date, time], (err) => {
            if (err) reject(err);
            else resolve({ success: true });
        });
    });
}

function getUpcomingAppointmentsByWhatsApp(phone) {
    return new Promise((resolve, reject) => {
        const now = moment();
        const today = now.format('YYYY-MM-DD');
        const currentTime = now.format('HH:mm');

        const phoneSuffix = phone.length > 10 ? phone.substring(phone.length - 10) : phone;

        db.all(
            `SELECT * FROM appointments 
             WHERE phone LIKE ? 
               AND (date > ? OR (date = ? AND time > ?))
               AND status = 'CONFIRMED'
             ORDER BY date ASC, time ASC`,
            [`%${phoneSuffix}`, today, today, currentTime],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

function getRangeSchedule(startDate, endDate) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT date, time, 1 as is_occupied, name, phone, service, voucher_url 
            FROM appointments 
            WHERE status='CONFIRMED' AND date >= ? AND date < ?
            UNION ALL
            SELECT date, time, 2 as is_occupied, null as name, null as phone, null as service, null as voucher_url 
            FROM availability 
            WHERE is_occupied = 2 AND date >= ? AND date < ?
        `, [startDate, endDate, startDate, endDate], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

module.exports = { 
    initDb, 
    getAvailableSlots, 
    bookSlot, 
    blockSlot, 
    unblockSlot, 
    getAllAppointments, 
    getDaySchedule,
    getUpcomingReminders,
    markReminderSent,
    cancelAppointment,
    updateAppointment,
    getUpcomingAppointmentsByWhatsApp,
    getRangeSchedule
};
