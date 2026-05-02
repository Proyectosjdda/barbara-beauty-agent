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
                if (err) return reject(err);
                // ✅ MIGRATION: Fix existing multi-hour appointments that only blocked 1 slot
                fixMultiSlotAppointments().then(resolve).catch(reject);
            });
        });
    });
}

// ✅ Startup migration: retroactively block missing consecutive slots for multi-hour appointments
async function fixMultiSlotAppointments() {
    return new Promise((resolve, reject) => {
        db.all("SELECT date, time, service FROM appointments WHERE status = 'CONFIRMED'", [], async (err, rows) => {
            if (err) return reject(err);
            let fixed = 0;
            for (const row of rows) {
                if (!row.service) continue;
                // Calculate total duration (handles combined services like "Wispy Look + Soft Brows")
                const services = row.service.split(' + ');
                const totalDuration = services.reduce((sum, svc) => sum + (SERVICE_DURATIONS[svc.trim()] || 60), 0);
                const slotsNeeded = Math.max(1, Math.ceil(totalDuration / 60));
                if (slotsNeeded <= 1) continue;

                const startHour = parseInt(row.time.split(':')[0], 10);
                await ensureSlotsExist(row.date);

                for (let i = 1; i < slotsNeeded; i++) {
                    const slotTime = `${String(startHour + i).padStart(2, '0')}:00`;
                    await new Promise((res, rej) => {
                        db.run(
                            "UPDATE availability SET is_occupied = 1 WHERE date = ? AND time = ? AND is_occupied = 0",
                            [row.date, slotTime],
                            function(err) {
                                if (err) return rej(err);
                                if (this.changes > 0) fixed++;
                                res();
                            }
                        );
                    });
                }
            }
            if (fixed > 0) {
                console.log(`[Migration] Fixed ${fixed} missing multi-hour slots for existing appointments.`);
            }
            resolve();
        });
    });
}

const WORKING_HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

// ✅ Duration per service (in minutes) — used to calculate multi-slot bookings/cancellations
const SERVICE_DURATIONS = {
    'Lash Bloom':        60,
    'Classic Glow':     120,
    'Deep Black Lash':  120,
    'Glam Lash':        120,
    'Tech Lash W 3D':   120,
    'Tech Lash W 4D':   120,
    'Tech Lash YY':     120,
    'Tech Lash W 5D':   120,
    'Tech Lash Coffee': 120,
    'Curva U':          120,
    'Luxe Lift Brows':   60,
    'Soft Brows':        60,
    'Clean Shape':       60,
    'Wispy Look':       150,
    'Kim-K Look':       150,
    'Comics Look':      150,
    'Foxy Tech':        150,
};

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

function bookSlot(name, phone, date, time, service, voucher_url = null, durationMinutes = 60) {
    return new Promise(async (resolve, reject) => {
        // Build list of all hour-slots this appointment will occupy
        const slotsNeeded = Math.max(1, Math.ceil(durationMinutes / 60));
        const startHour = parseInt(time.split(':')[0], 10);
        const allSlots = [];
        for (let i = 0; i < slotsNeeded; i++) {
            allSlots.push(`${String(startHour + i).padStart(2, '0')}:00`);
        }

        console.log(`[bookSlot] Booking ${slotsNeeded} slots: ${allSlots.join(', ')} for ${service} (${durationMinutes}min)`);

        // ✅ FIX: Ensure all consecutive slots exist in the availability table FIRST
        await ensureSlotsExist(date);

        db.serialize(() => {
            // Check ALL required slots are free
            const placeholders = allSlots.map(() => '?').join(',');
            db.all(
                `SELECT time, is_occupied FROM availability WHERE date = ? AND time IN (${placeholders})`,
                [date, ...allSlots],
                (err, rows) => {
                    if (err) return reject(err);
                    const allFree = rows.length === slotsNeeded && rows.every(r => r.is_occupied === 0);
                    if (!allFree) {
                        return resolve({ success: false, message: 'El horario ya no está disponible.' });
                    }

                    db.run("BEGIN TRANSACTION");
                    // Block all slots in availability
                    allSlots.forEach(slotTime => {
                        db.run("UPDATE availability SET is_occupied = 1 WHERE date = ? AND time = ?", [date, slotTime]);
                    });
                    // Single appointment record at the START time
                    db.run(
                        "INSERT INTO appointments (name, phone, date, time, service, voucher_url) VALUES (?, ?, ?, ?, ?, ?)",
                        [name, phone, date, time, service, voucher_url]
                    );
                    db.run("COMMIT", (err) => {
                        if (err) {
                            db.run("ROLLBACK");
                            reject(err);
                        } else {
                            resolve({ success: true });
                        }
                    });
                }
            );
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
        // First, look up the service to know how many slots to free
        db.get("SELECT service FROM appointments WHERE date = ? AND time = ?", [date, time], (err, row) => {
            if (err) return reject(err);

            // Calculate how many consecutive slots this appointment occupies
            let slotsToFree = 1;
            if (row && row.service) {
                // Handle combined services like "Wispy Look + Soft Brows"
                const services = row.service.split(' + ');
                const totalDuration = services.reduce((sum, svc) => sum + (SERVICE_DURATIONS[svc.trim()] || 60), 0);
                slotsToFree = Math.max(1, Math.ceil(totalDuration / 60));
            }
            const startHour = parseInt(time.split(':')[0], 10);
            const allSlots = [];
            for (let i = 0; i < slotsToFree; i++) {
                allSlots.push(`${String(startHour + i).padStart(2, '0')}:00`);
            }

            console.log(`[cancelAppointment] Freeing ${slotsToFree} slots: ${allSlots.join(', ')}`);

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                // Free ALL consecutive slots
                allSlots.forEach(slotTime => {
                    db.run("UPDATE availability SET is_occupied = 0 WHERE date = ? AND time = ?", [date, slotTime]);
                });
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
