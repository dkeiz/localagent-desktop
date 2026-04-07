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
        window.electronAPI.onTodoUpdate(() => {
            this.loadTodos();
        });
    }

    async loadTodos() {
        try {
            this.todos = await window.electronAPI.getTodos();
            this.renderTodos();
        } catch (error) {
            console.error('Error loading todos:', error);
        }
    }

    renderTodos() {
        const container = document.getElementById('todo-list');
        container.innerHTML = '';

        if (this.todos.length === 0) {
            container.innerHTML = '<p class="no-todos">No tasks yet</p>';
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
            completedHeader.innerHTML = '<h4>Completed</h4>';
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
        
        element.innerHTML = `
            <input type="checkbox" ${todo.completed ? 'checked' : ''} data-id="${todo.id}">
            <span class="task">${todo.task}</span>
            ${todo.priority > 1 ? `<span class="priority">P${todo.priority}</span>` : ''}
            ${todo.due_date ? `<span class="due-date">${new Date(todo.due_date).toLocaleDateString()}</span>` : ''}
            <button class="icon-btn delete-todo" data-id="${todo.id}">🗑️</button>
        `;

        // Add event listeners
        const checkbox = element.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', () => {
            this.toggleTodo(todo.id, checkbox.checked);
        });

        element.querySelector('.delete-todo').addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteTodo(todo.id);
        });

        return element;
    }

    async addTodo() {
        const input = document.getElementById('new-todo-input');
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
