class CalendarWidget {
    constructor() {
        this.events = [];
        this.renderCalendar();
        this.initializeEvents();
    }

    initializeEvents() {
        // Load initial events
        this.loadEvents();

        // Add event button
        document.getElementById('add-event-btn').addEventListener('click', () => {
            this.showAddEventModal();
        });

        // Listen for calendar updates
        window.electronAPI.onCalendarUpdate(() => {
            this.loadEvents();
        });
    }

    async loadEvents() {
        try {
            this.events = await window.electronAPI.getCalendarEvents();
            this.renderEvents();
            this.renderCalendar();
        } catch (error) {
            console.error('Error loading calendar events:', error);
        }
    }

    renderEvents() {
        const container = document.getElementById('calendar-events');
        container.innerHTML = '';

        if (this.events.length === 0) {
            container.innerHTML = '<p class="no-events">No upcoming events</p>';
            return;
        }

        // Sort events by start time
        const sortedEvents = [...this.events].sort((a, b) => 
            new Date(a.start_time) - new Date(b.start_time)
        );

        // Show only upcoming events (next 7 days)
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        sortedEvents.forEach(event => {
            const eventDate = new Date(event.start_time);
            if (eventDate >= now && eventDate <= sevenDaysFromNow) {
                const eventElement = this.createEventElement(event);
                container.appendChild(eventElement);
            }
        });

        if (container.children.length === 0) {
            container.innerHTML = '<p class="no-events">No events in the next 7 days</p>';
        }
    }

    renderCalendar() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const today = now.getDate();

        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        const firstDayOfWeek = firstDayOfMonth.getDay();
        const totalDays = lastDayOfMonth.getDate();

        // Update calendar header with current month/year
        const calendarHeader = document.getElementById('calendar-header');
        if (calendarHeader) {
            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
            calendarHeader.textContent = `${monthNames[month]} ${year}`;
        }

        this.renderWeekdays();
        const daysContainer = document.getElementById('calendar-days');
        daysContainer.innerHTML = '';

        // Add padding for days before the 1st
        for (let i = 0; i < firstDayOfWeek; i++) {
            const paddingDay = document.createElement('div');
            paddingDay.className = 'calendar-day empty';
            daysContainer.appendChild(paddingDay);
        }

        // Add days of the month
        for (let day = 1; day <= totalDays; day++) {
            const dayElement = document.createElement('div');
            dayElement.className = 'calendar-day';
            if (day === today) {
                dayElement.classList.add('today');
            }
            dayElement.textContent = day;

            dayElement.addEventListener('click', (event) => {
                const selected = document.querySelector('.calendar-day.selected');
                if (selected) {
                    selected.classList.remove('selected');
                }
                event.currentTarget.classList.add('selected');
                
                // Filter chats by this day
                const clickedDate = new Date(year, month, day).toISOString().split('T')[0];
                if (window.sidebar) {
                    window.sidebar.loadChatSessions(clickedDate);
                }
            });
            
            daysContainer.appendChild(dayElement);
        }
    }

    renderWeekdays() {
        const weekdaysContainer = document.getElementById('calendar-weekdays');
        weekdaysContainer.innerHTML = '';
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        weekdays.forEach(day => {
            const weekdayElement = document.createElement('div');
            weekdayElement.className = 'calendar-weekday';
            weekdayElement.textContent = day;
            weekdaysContainer.appendChild(weekdayElement);
        });
    }

    createEventElement(event) {
        const element = document.createElement('div');
        element.className = 'calendar-event';
        
        const startTime = new Date(event.start_time);
        const endTime = new Date(startTime.getTime() + event.duration_minutes * 60000);
        
        element.innerHTML = `
            <h4>${event.title}</h4>
            <div class="time">
                ${startTime.toLocaleDateString()} •
                ${startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} -
                ${endTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </div>
            ${event.description ? `<div class="description">${event.description}</div>` : ''}
            <div class="event-actions">
                <button class="icon-btn delete-event" data-id="${event.id}">🗑️</button>
            </div>
        `;

        // Add delete event listener
        element.querySelector('.delete-event').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteEvent(event.id);
        });

        return element;
    }

    showAddEventModal() {
        // Simple modal for adding events
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Add Calendar Event</h3>
                <form id="add-event-form">
                    <label>
                        Title:
                        <input type="text" name="title" required>
                    </label>
                    <label>
                        Start Time:
                        <input type="datetime-local" name="start_time" required>
                    </label>
                    <label>
                        Duration (minutes):
                        <input type="number" name="duration_minutes" value="60" min="1">
                    </label>
                    <label>
                        Description:
                        <textarea name="description" rows="3"></textarea>
                    </label>
                    <div class="modal-actions">
                        <button type="button" class="secondary-btn cancel-btn">Cancel</button>
                        <button type="submit" class="primary-btn">Add Event</button>
                    </div>
                </form>
            </div>
        `;

        // Add modal styles
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        `;

        modal.querySelector('.modal-content').style.cssText = `
            background: white;
            padding: 2rem;
            border-radius: var(--border-radius);
            width: 400px;
            max-width: 90%;
        `;

        // Set default start time to current time rounded to next 15 minutes
        const now = new Date();
        const minutes = Math.ceil(now.getMinutes() / 15) * 15;
        now.setMinutes(minutes);
        now.setSeconds(0);
        now.setMilliseconds(0);
        
        const startTimeInput = modal.querySelector('input[name="start_time"]');
        startTimeInput.value = now.toISOString().slice(0, 16);

        // Form submission
        modal.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const eventData = {
                title: formData.get('title'),
                start_time: formData.get('start_time'),
                duration_minutes: parseInt(formData.get('duration_minutes')),
                description: formData.get('description')
            };

            try {
                await window.electronAPI.addCalendarEvent(eventData);
                modal.remove();
            } catch (error) {
                console.error('Error adding event:', error);
                alert('Error adding event: ' + error.message);
            }
        });

        // Cancel button
        modal.querySelector('.cancel-btn').addEventListener('click', () => {
            modal.remove();
        });

        document.body.appendChild(modal);
    }

    async deleteEvent(eventId) {
        if (confirm('Are you sure you want to delete this event?')) {
            try {
                await window.electronAPI.deleteCalendarEvent(eventId);
            } catch (error) {
                console.error('Error deleting event:', error);
                alert('Error deleting event: ' + error.message);
            }
        }
    }
}

// Initialize calendar when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.calendarWidget = new CalendarWidget();
});
