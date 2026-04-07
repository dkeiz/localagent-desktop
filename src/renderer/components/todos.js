class TodoWidget {
    constructor() {
        this.todos = [];
        this.initializeEvents();
    }

    initializeEvents() {
        // Load initial todos
        this.loadTodos();

        // Add todo functionality
        const addTodoBtn = document.getElementById('add-todo-btn');
        const newTodoInput = document.getElementById('new-todo-input');
        
        if (addTodoBtn) addTodoBtn.addEventListener('click', () => this.addTodo());
        if (newTodoInput) newTodoInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.addTodo();
            }
        });

        // Listen for todo updates
        if (typeof window.electronAPI?.onTodoUpdate === 'function') {
            window.electronAPI.onTodoUpdate(() => {
                this.loadTodos();
            });
        }
    }

    async loadTodos() {
        try {
            if (typeof window.electronAPI?.getTodos !== 'function') {
                this.todos = [];
                this.renderTodos();
                return;
            }
            this.todos = await window.electronAPI.getTodos();
            this.renderTodos();
        } catch (error) {
            console.error('Error loading todos:', error);
        }
    }

    renderTodos() {
        const container = document.getElementById('todo-list');
        if (!container) return;
        container.replaceChildren();

        if (this.todos.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'no-todos';
            empty.textContent = 'No tasks yet';
            container.appendChild(empty);
            return;
        }

        // Show incomplete todos first, then completed
        const incompleteTodos = this.todos.filter(todo => !todo.completed);
        const completedTodos = this.todos.filter(todo => todo.completed);

        incompleteTodos.forEach(todo => {
            const todoElement = this.createTodoElement(todo);
            container.appendChild(todoElement);
        });

        if (completedTodos.length > 0) {
            const completedHeader = document.createElement('div');
            completedHeader.className = 'completed-header';
            const title = document.createElement('h4');
            title.textContent = 'Completed';
            completedHeader.appendChild(title);
            container.appendChild(completedHeader);

            completedTodos.forEach(todo => {
                const todoElement = this.createTodoElement(todo);
                container.appendChild(todoElement);
            });
        }
    }

    createTodoElement(todo) {
        const element = document.createElement('div');
        element.className = `todo-item ${todo.completed ? 'completed' : ''}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = todo.completed === true;
        checkbox.dataset.id = String(todo.id);
        element.appendChild(checkbox);

        const task = document.createElement('span');
        task.className = 'task';
        task.textContent = todo.task;
        element.appendChild(task);

        if (todo.priority > 1) {
            const priority = document.createElement('span');
            priority.className = 'priority';
            priority.textContent = `P${todo.priority}`;
            element.appendChild(priority);
        }

        if (todo.due_date) {
            const dueDate = document.createElement('span');
            dueDate.className = 'due-date';
            dueDate.textContent = new Date(todo.due_date).toLocaleDateString();
            element.appendChild(dueDate);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete-todo';
        deleteBtn.dataset.id = String(todo.id);
        deleteBtn.textContent = '🗑️';
        element.appendChild(deleteBtn);

        // Add event listeners
        checkbox.addEventListener('change', () => {
            this.toggleTodo(todo.id, checkbox.checked);
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteTodo(todo.id);
        });

        return element;
    }

    async addTodo() {
        const input = document.getElementById('new-todo-input');
        if (!input) return;
        const task = input.value.trim();
        
        if (!task) return;

        try {
            await window.electronAPI.addTodo({ task });
            input.value = '';
            input.focus();
        } catch (error) {
            console.error('Error adding todo:', error);
            alert('Error adding todo: ' + error.message);
        }
    }

    async toggleTodo(id, completed) {
        try {
            await window.electronAPI.updateTodo(id, { completed });
        } catch (error) {
            console.error('Error updating todo:', error);
            // Revert checkbox state on error
            const checkbox = document.querySelector(`input[data-id="${id}"]`);
            if (checkbox) {
                checkbox.checked = !completed;
            }
        }
    }

    async deleteTodo(id) {
        if (confirm('Are you sure you want to delete this task?')) {
            try {
                await window.electronAPI.deleteTodo(id);
            } catch (error) {
                console.error('Error deleting todo:', error);
                alert('Error deleting todo: ' + error.message);
            }
        }
    }
}

// Initialize todo widget when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.todoWidget = new TodoWidget();
});
