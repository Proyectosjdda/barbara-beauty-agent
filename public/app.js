let currentTab = 'calendar';
let calendar = null;

document.addEventListener('DOMContentLoaded', function() {
    initCalendar();
    
    // Tab switching logic
    window.showTab = function(tab) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-links li').forEach(el => el.classList.remove('active'));
        
        document.getElementById(`${tab}-tab`).classList.add('active');
        event.currentTarget.classList.add('active');
        currentTab = tab;
        
        if (tab === 'calendar') {
            calendar.render();
            loadSchedule();
        }
    }

    // Auto-refresh schedule every 5 seconds
    setInterval(() => {
        if (currentTab === 'calendar') {
            console.log("Auto-refreshing schedule...");
            loadSchedule();
        }
    }, 5000);

    // Refresh button logic
    window.refreshSchedule = function() {
        const btn = document.querySelector('.refresh-btn');
        btn.classList.add('rotating');
        loadSchedule().finally(() => {
            setTimeout(() => btn.classList.remove('rotating'), 500);
        });
    }

    // Chat handling
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (!msg) return;

        // Add user message
        addMessage(msg, 'user');
        chatInput.value = '';

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: msg })
            });
            const data = await response.json();
            const botMsg = data.message || data.response || "No entendí la respuesta del servidor.";
            addMessage(botMsg, 'bot');
            
            // If actions were taken, refresh calendar in background
            if (data.actions && data.actions.length > 0) {
                loadSchedule();
            }
        } catch (err) {
            addMessage("Error al conectar con el servidor.", 'bot');
        }
    });

    function addMessage(text, side) {
        const div = document.createElement('div');
        div.className = `message ${side}`;
        div.innerHTML = `<p>${text}</p>`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
});

function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridDay',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridDay,dayGridMonth'
        },
        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            day: 'Día'
        },
        height: 'auto',
        nowIndicator: true,
        locale: 'es',
        slotMinTime: '07:00:00',
        slotMaxTime: '20:00:00',
        slotDuration: '01:00:00',
        allDaySlot: false,
        slotLabelFormat: { hour: 'numeric', minute: '2-digit', hour12: true },
        eventTimeFormat: { hour: 'numeric', minute: '2-digit', hour12: true },
        dayMaxEvents: 3,
        events: async function(info, successCallback, failureCallback) {
            try {
                const response = await fetch(`/api/schedule?start=${info.startStr}&end=${info.endStr}`);
                const schedule = await response.json();
                
                if (calendar && calendar.view && calendar.view.type === 'dayGridMonth') {
                    const counts = {};
                    schedule.forEach(item => {
                        if (item.is_occupied !== 0) {
                            counts[item.date] = (counts[item.date] || 0) + 1;
                        }
                    });
                    
                    const isMobile = window.innerWidth < 600;
                    const events = Object.keys(counts).map(date => ({
                        title: isMobile ? `${counts[date]} ${counts[date] === 1 ? 'turno' : 'turnos'}` : `${counts[date]} turnos agendados`,
                        start: date,
                        allDay: true,
                        backgroundColor: 'transparent',
                        borderColor: 'transparent',
                        textColor: '#fff',
                        className: 'summary-event'
                    }));
                    successCallback(events);
                } else {
                    const events = schedule
                        .filter(item => item.is_occupied !== 0)
                        .map(item => {
                            const start = `${item.date}T${item.time}:00`;
                            const endHour = String(parseInt(item.time.split(':')[0], 10) + 1).padStart(2, '0');
                            const end = `${item.date}T${endHour}:00:00`;
                            
                            return {
                                title: item.is_occupied === 2 ? '🛡️ Bloqueado' : `👤 ${item.name || 'Cita'} (${item.phone || '-'})`,
                                start,
                                end,
                                backgroundColor: item.is_occupied === 2 ? '#FFD1DC' : '#FF66B2',
                                textColor: item.is_occupied === 2 ? '#333' : '#fff',
                                extendedProps: { status: item.is_occupied, phone: item.phone, service: item.service }
                            };
                        });
                    successCallback(events);
                }
            } catch (err) {
                console.error("Error loading schedule:", err);
                failureCallback(err);
            }
        },
        dateClick: async function(info) {
            if (info.view.type === 'dayGridMonth') {
                calendar.changeView('timeGridDay', info.dateStr);
                setTimeout(() => loadSchedule(), 50);
                return;
            }
            const timeStr = info.date.toTimeString().split(' ')[0].substring(0, 5);
            if (confirm(`¿Deseas bloquear el horario de las ${timeStr} para asuntos personales?`)) {
                try {
                    const response = await fetch('/api/block', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            date: info.dateStr.split('T')[0],
                            time: timeStr
                        })
                    });
                    const result = await response.json();
                    if (result.success) loadSchedule();
                } catch (err) { alert('Error al bloquear'); }
            }
        },
        eventContent: function(arg) {
            const isBlocked = arg.event.extendedProps.status === 2;
            const container = document.createElement('div');
            container.className = 'fc-event-main-container';
            container.style.display = 'flex';
            container.style.justifyContent = 'space-between';
            container.style.alignItems = 'center';
            container.style.width = '100%';
            
            const textContent = document.createElement('div');
            textContent.style.display = 'flex';
            textContent.style.flexDirection = 'row';
            textContent.style.alignItems = 'center';
            textContent.style.gap = '15px';
            textContent.style.overflow = 'hidden';

            const title = document.createElement('div');
            title.className = 'fc-event-title-container';
            title.innerText = arg.event.title;
            textContent.appendChild(title);

            if (!isBlocked) {
                const serviceRaw = arg.event.extendedProps.service;
                if (serviceRaw) {
                    const svcTitle = document.createElement('div');
                    svcTitle.innerText = `| 💅 ${serviceRaw}`;
                    svcTitle.style.fontSize = '14px';
                    svcTitle.style.fontWeight = 'bold';
                    svcTitle.style.color = '#000';
                    svcTitle.style.whiteSpace = 'nowrap';
                    textContent.appendChild(svcTitle);
                }
            }

            container.appendChild(textContent);

            if (!isBlocked) {
                const actions = document.createElement('div');
                actions.className = 'event-actions';
                
                // Edit Button
                const editBtn = document.createElement('button');
                editBtn.innerHTML = '✏️';
                editBtn.title = 'Editar';
                editBtn.onclick = (e) => {
                    e.stopPropagation();
                    editAppointment(arg.event);
                };
                
                // Delete Button
                const delBtn = document.createElement('button');
                delBtn.innerHTML = '🗑️';
                delBtn.title = 'Eliminar';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteAppointment(arg.event);
                };

                actions.appendChild(editBtn);
                actions.appendChild(delBtn);
                container.appendChild(actions);
            } else {
                // For blocked slots, just a Delete (Unblock) button
                const actions = document.createElement('div');
                actions.className = 'event-actions';
                const unblockBtn = document.createElement('button');
                unblockBtn.innerHTML = '🔓';
                unblockBtn.title = 'Desbloquear';
                unblockBtn.onclick = (e) => {
                    e.stopPropagation();
                    unblockSlotManual(arg.event);
                };
                actions.appendChild(unblockBtn);
                container.appendChild(actions);
            }

            return { domNodes: [container] };
        },
        eventDidMount: function(info) {
            if (info.event.extendedProps.status === 2) {
                info.el.style.backgroundColor = '#444';
                info.el.style.borderColor = '#666';
                info.el.style.opacity = '0.7';
            }
        },
        viewDidMount: function(arg) {
            setTimeout(() => { if (calendar) calendar.refetchEvents(); }, 50);
        },
        datesSet: function(arg) {
            setupMonthPicker();
        }
    });

    async function deleteAppointment(event) {
        if (confirm(`¿Seguro que quieres eliminar la cita de ${event.title}?`)) {
            try {
                const response = await fetch('/api/cancel-appointment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        date: event.startStr.split('T')[0],
                        time: event.start.toTimeString().split(' ')[0].substring(0, 5)
                    })
                });
                const result = await response.json();
                if (result.success) loadSchedule();
            } catch (err) { alert('Error al eliminar'); }
        }
    }

    async function unblockSlotManual(event) {
        if (confirm(`¿Desbloquear este horario?`)) {
            try {
                const response = await fetch('/api/unblock', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        date: event.startStr.split('T')[0],
                        time: event.start.toTimeString().split(' ')[0].substring(0, 5)
                    })
                });
                const result = await response.json();
                if (result.success) loadSchedule();
            } catch (err) { alert('Error al desbloquear'); }
        }
    }

    async function editAppointment(event) {
        const currentName = event.title.split(' (')[0].replace('👤 ', '');
        const currentPhone = event.extendedProps.phone || '';
        
        const newName = prompt("📝 Edita el nombre del cliente (O deja el mismo):", currentName);
        if (newName === null) return;
        
        const newPhone = prompt("📱 Edita el teléfono del cliente (O deja el mismo):", currentPhone);
        if (newPhone === null) return;

        try {
            const response = await fetch('/api/update-appointment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: event.startStr.split('T')[0],
                    time: event.start.toTimeString().split(' ')[0].substring(0, 5),
                    name: newName,
                    phone: newPhone
                })
            });
            const result = await response.json();
            if (result.success) loadSchedule();
        } catch (err) { alert('Error al actualizar'); }
    }
    
    calendar.render();
    loadSchedule();
}

async function loadSchedule() {
    if (calendar) {
        calendar.refetchEvents();
    }
}

function setupMonthPicker() {
    const titleEl = document.querySelector('.fc-toolbar-title');
    if (!titleEl) return;
    
    titleEl.style.cursor = 'pointer';
    titleEl.title = 'Haz clic para explorar meses';
    titleEl.style.transition = 'all 0.2s';
    
    titleEl.onmouseover = () => titleEl.style.opacity = '0.7';
    titleEl.onmouseout = () => titleEl.style.opacity = '1';

    let popup = document.getElementById('beautiful-month-picker');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'beautiful-month-picker';
        popup.style.position = 'absolute';
        popup.style.background = '#FFF';
        popup.style.border = '2px solid #FFD1DC';
        popup.style.borderRadius = '12px';
        popup.style.padding = '15px';
        popup.style.boxShadow = '0 10px 25px rgba(255, 102, 178, 0.2)';
        popup.style.display = 'none';
        popup.style.zIndex = '1000';
        popup.style.width = '260px';
        popup.style.gridTemplateColumns = 'repeat(3, 1fr)';
        popup.style.gap = '8px';
        document.body.appendChild(popup);

        // Get the calendar's current viewing year
        const currentYear = calendar ? calendar.getDate().getFullYear() : new Date().getFullYear();
        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        
        const yearHeaderRow = document.createElement('div');
        yearHeaderRow.style.gridColumn = '1 / -1';
        yearHeaderRow.style.display = 'flex';
        yearHeaderRow.style.justifyContent = 'space-between';
        yearHeaderRow.style.alignItems = 'center';
        yearHeaderRow.style.marginBottom = '10px';

        const prevBtn = document.createElement('button');
        prevBtn.innerText = '‹';
        prevBtn.style.background = 'none';
        prevBtn.style.border = 'none';
        prevBtn.style.fontSize = '20px';
        prevBtn.style.color = '#FF66B2';
        prevBtn.style.cursor = 'pointer';
        
        const yearSpan = document.createElement('span');
        yearSpan.style.fontWeight = 'bold';
        yearSpan.style.color = '#FF66B2';
        yearSpan.style.fontSize = '16px';
        yearSpan.innerText = currentYear;
        // store current picker year
        popup.dataset.year = currentYear;

        const nextBtn = document.createElement('button');
        nextBtn.innerText = '›';
        nextBtn.style.background = 'none';
        nextBtn.style.border = 'none';
        nextBtn.style.fontSize = '20px';
        nextBtn.style.color = '#FF66B2';
        nextBtn.style.cursor = 'pointer';

        prevBtn.onclick = (e) => { e.stopPropagation(); popup.dataset.year = parseInt(popup.dataset.year) - 1; yearSpan.innerText = popup.dataset.year; };
        nextBtn.onclick = (e) => { e.stopPropagation(); popup.dataset.year = parseInt(popup.dataset.year) + 1; yearSpan.innerText = popup.dataset.year; };

        yearHeaderRow.appendChild(prevBtn);
        yearHeaderRow.appendChild(yearSpan);
        yearHeaderRow.appendChild(nextBtn);
        popup.appendChild(yearHeaderRow);

        months.forEach((m, i) => {
            const btn = document.createElement('button');
            btn.innerText = m;
            btn.style.background = '#FFF0F5';
            btn.style.border = '1px solid #FFD1DC';
            btn.style.color = '#333';
            btn.style.padding = '8px 5px';
            btn.style.borderRadius = '6px';
            btn.style.cursor = 'pointer';
            btn.style.fontWeight = 'bold';
            btn.style.transition = 'all 0.2s';
            
            btn.onmouseover = () => { btn.style.background = '#FF66B2'; btn.style.color = '#FFF'; };
            btn.onmouseout = () => { btn.style.background = '#FFF0F5'; btn.style.color = '#333'; };

            btn.onclick = (e) => {
                e.stopPropagation();
                const monthStr = (i + 1).toString().padStart(2, '0');
                const targetYear = popup.dataset.year;
                calendar.gotoDate(`${targetYear}-${monthStr}-01`);
                loadSchedule();
                popup.style.display = 'none';
            };
            popup.appendChild(btn);
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target !== titleEl && !popup.contains(e.target)) {
                popup.style.display = 'none';
            }
        });
    }
    
    // Update year to current calendar year when opening
    titleEl.onclick = (e) => {
        e.stopPropagation();
        const rect = titleEl.getBoundingClientRect();
        if (calendar) {
            const cy = calendar.getDate().getFullYear();
            popup.dataset.year = cy;
            popup.querySelector('span').innerText = cy;
        }
        popup.style.left = (rect.left + window.scrollX + (rect.width / 2) - 130) + 'px';
        popup.style.top = (rect.bottom + window.scrollY + 10) + 'px';
        popup.style.display = popup.style.display === 'none' ? 'grid' : 'none';
    };
}
