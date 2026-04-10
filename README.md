# BarberBot 2.0 - Dashboard y Agente de WhatsApp

Este sistema combina un potente agente de WhatsApp para tus clientes con un Panel de Control web para que gestiones tu agenda.

## Requisitos
- Node.js instalado.
- WhatsApp en tu teléfono.
- API Key de Gemini (para la IA de WhatsApp y el chat del manager).

## Instalación

1.  **Variables de entorno**:
    Asegúrate de que tu archivo `.env` tenga tu `GEMINI_API_KEY`.
    ```
    GEMINI_API_KEY=AIzaSyAsFUhhIH0kVCZSHx79jttLhe6mnP-cSMk
    ```

2.  **Ejecutar el sistema**:
    Ahora todo corre desde un solo comando:
    ```powershell
    & "C:\Program Files\nodejs\node.exe" server.js
    ```

3.  **Vincular WhatsApp**:
    Escanea el código QR que aparecerá en la terminal.

4.  **Acceder al Dashboard**:
    Abre tu navegador (Chrome/Edge) y ve a:
    [http://localhost:3000](http://localhost:3000)

## Funcionalidades del Dashboard

### 1. Calendario Interactivo
- Visualiza todas las citas agendadas por el bot en tiempo real.
- Horario extendido de **9:00 AM a 10:00 PM**.
- Colores específicos: Oro para citas, Gris para horarios bloqueados.

### 2. Chat con el Agente (Manager Chat)
En la pestaña de Chat, puedes darle órdenes naturales a tu asistente:
- *"Bloquea mañana de 15:00 a 17:00"*
- *"Libera el turno de las 10 de hoy"*
- *"No voy a trabajar el próximo lunes"*

El asistente procesará la orden y actualizará la disponibilidad del bot de WhatsApp al instante.

## Archivos del Proyecto
- `server.js`: Servidor principal (Express).
- `bot.js`: Lógica del bot de WhatsApp.
- `database.js`: Motor de base de datos y citas.
- `managerService.js`: Inteligencia para el chat del dueño.
- `intentService.js`: Inteligencia para el chat de clientes.
- `public/`: Archivos de la interfaz web (HTML/CSS/JS).
