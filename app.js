// Task Manager Application Logic

let appConfig = null;
let editingTaskId = null;
let tasksCache = [];

// DOM Elements
const taskForm = document.getElementById('task-form');
const taskTitleInput = document.getElementById('task-title');
const taskDescriptionInput = document.getElementById('task-description');
const taskSubmitBtn = document.getElementById('task-submit');
const taskCancelBtn = document.getElementById('task-cancel');
const formHeading = document.getElementById('form-heading');
const taskListContainer = document.getElementById('task-list');
const statusMessageEl = document.getElementById('status-message');
const refreshBtn = document.getElementById('refresh-tasks-btn');

/**
 * Display a message to the user
 * @param {string} message - Message text
 * @param {'success' | 'error' | 'info'} type - Type of message
 * @param {number} duration - Auto-hide timeout in ms (0 = keep visible)
 */
function showStatus(message, type = 'info', duration = 5000) {
  if (!statusMessageEl) return;
  
  statusMessageEl.textContent = message;
  statusMessageEl.className = `status-message visible status-${type}`;

  if (statusMessageEl._timeout) {
    clearTimeout(statusMessageEl._timeout);
  }

  if (duration > 0) {
    statusMessageEl._timeout = setTimeout(() => {
      statusMessageEl.className = 'status-message';
      statusMessageEl.textContent = '';
    }, duration);
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Load public configuration from config.json
 */
async function loadConfig() {
  try {
    const response = await fetch('./config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load config.json (HTTP ${response.status})`);
    }
    const config = await response.json();

    if (!config.supabaseUrl || !config.supabasePublishableKey || !config.tableName) {
      throw new Error('config.json is missing required fields (supabaseUrl, supabasePublishableKey, or tableName).');
    }

    if (config.supabaseUrl.includes('YOUR_PROJECT_ID') || config.supabasePublishableKey.includes('YOUR_SUPABASE_ANON_KEY')) {
      showStatus(
        'Welcome! Please replace placeholder credentials in config.json with your Supabase Project URL and Anon Key.',
        'info',
        0
      );
      return null;
    }

    appConfig = config;
    return config;
  } catch (error) {
    console.error('Configuration error:', error);
    showStatus(`Configuration error: ${error.message}`, 'error', 0);
    return null;
  }
}

/**
 * Get base REST API endpoint for tasks
 */
function getApiEndpoint() {
  if (!appConfig) return '';
  const base = appConfig.supabaseUrl.replace(/\/+$/, '');
  const table = encodeURIComponent(appConfig.tableName || 'tasks');
  return `${base}/rest/v1/${table}`;
}

/**
 * Common headers for Supabase REST API requests
 */
function getHeaders(preferRepresentation = false) {
  const headers = {
    'apikey': appConfig.supabasePublishableKey,
    'Authorization': `Bearer ${appConfig.supabasePublishableKey}`,
    'Content-Type': 'application/json'
  };

  if (preferRepresentation) {
    headers['Prefer'] = 'return=representation';
  }

  return headers;
}

/**
 * Fetch all tasks from Supabase REST API
 */
async function fetchTasks() {
  if (!appConfig) return;

  try {
    const endpoint = `${getApiEndpoint()}?select=*&order=id.asc`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: getHeaders()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to load tasks (HTTP ${response.status}): ${errText}`);
    }

    const tasks = await response.json();
    tasksCache = Array.isArray(tasks) ? tasks : [];
    renderTaskList(tasksCache);
  } catch (error) {
    console.error('Fetch tasks error:', error);
    showStatus(`Error loading tasks: ${error.message}`, 'error');
  }
}

/**
 * Render tasks into the #task-list container
 */
function renderTaskList(tasks) {
  if (!taskListContainer) return;

  taskListContainer.innerHTML = '';

  if (!tasks || tasks.length === 0) {
    taskListContainer.innerHTML = `
      <li class="empty-state">
        <p>No tasks found. Add your first task using the form above!</p>
      </li>
    `;
    return;
  }

  tasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `task-item ${task.completed ? 'is-completed' : ''}`;
    li.setAttribute('data-id', task.id);

    const isCompleted = Boolean(task.completed);
    const statusText = isCompleted ? 'Completed' : 'Incomplete';
    const toggleButtonText = isCompleted ? 'Mark Incomplete' : 'Mark Complete';

    li.innerHTML = `
      <div class="task-info">
        <div class="task-header-row">
          <h3 class="task-title">${escapeHtml(task.title)}</h3>
          <span class="task-status ${isCompleted ? 'status-completed' : 'status-incomplete'}">${statusText}</span>
        </div>
        <p class="task-description">${escapeHtml(task.description || '(No description)')}</p>
      </div>
      <div class="task-actions">
        <button type="button" class="btn btn-action toggle-task" data-id="${task.id}" aria-label="Toggle status">
          ${toggleButtonText}
        </button>
        <button type="button" class="btn btn-action edit-task" data-id="${task.id}" aria-label="Edit task">
          Edit
        </button>
        <button type="button" class="btn btn-action delete-task" data-id="${task.id}" aria-label="Delete task">
          Delete
        </button>
      </div>
    `;

    taskListContainer.appendChild(li);
  });
}

/**
 * Create a new task via POST /tasks
 */
async function createTask(title, description) {
  if (!appConfig) {
    showStatus('Please configure Supabase credentials in config.json first.', 'error');
    return;
  }

  showStatus('Adding task...', 'info', 2000);

  try {
    const endpoint = getApiEndpoint();
    const payload = {
      title: title.trim(),
      description: description ? description.trim() : null,
      completed: false
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: getHeaders(true),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to create task (HTTP ${response.status}): ${errText}`);
    }

    showStatus('Task created successfully!', 'success');
    resetForm();
    await fetchTasks();
  } catch (error) {
    console.error('Create task error:', error);
    showStatus(`Failed to add task: ${error.message}`, 'error');
  }
}

/**
 * Update an existing task via PATCH /tasks?id=eq.ID
 */
async function updateTask(id, title, description) {
  if (!appConfig) return;

  showStatus('Saving changes...', 'info', 2000);

  try {
    const endpoint = `${getApiEndpoint()}?id=eq.${id}`;
    const payload = {
      title: title.trim(),
      description: description ? description.trim() : null
    };

    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: getHeaders(true),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to update task (HTTP ${response.status}): ${errText}`);
    }

    showStatus('Task updated successfully!', 'success');
    resetForm();
    await fetchTasks();
  } catch (error) {
    console.error('Update task error:', error);
    showStatus(`Failed to update task: ${error.message}`, 'error');
  }
}

/**
 * Toggle task completed status via PATCH /tasks?id=eq.ID
 */
async function toggleTaskStatus(id, currentCompleted) {
  if (!appConfig) return;

  try {
    const endpoint = `${getApiEndpoint()}?id=eq.${id}`;
    const newStatus = !currentCompleted;

    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: getHeaders(true),
      body: JSON.stringify({ completed: newStatus })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to update status (HTTP ${response.status}): ${errText}`);
    }

    showStatus(`Task marked as ${newStatus ? 'completed' : 'incomplete'}.`, 'success');
    await fetchTasks();
  } catch (error) {
    console.error('Toggle status error:', error);
    showStatus(`Failed to change status: ${error.message}`, 'error');
  }
}

/**
 * Delete a task via DELETE /tasks?id=eq.ID
 */
async function deleteTask(id) {
  if (!appConfig) return;

  const confirmed = confirm('Are you sure you want to delete this task?');
  if (!confirmed) return;

  showStatus('Deleting task...', 'info', 2000);

  try {
    const endpoint = `${getApiEndpoint()}?id=eq.${id}`;
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: getHeaders()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to delete task (HTTP ${response.status}): ${errText}`);
    }

    showStatus('Task deleted successfully.', 'success');
    if (editingTaskId === id) {
      resetForm();
    }
    await fetchTasks();
  } catch (error) {
    console.error('Delete task error:', error);
    showStatus(`Failed to delete task: ${error.message}`, 'error');
  }
}

/**
 * Set form to edit mode with selected task data
 */
function startEditTask(task) {
  editingTaskId = task.id;
  taskTitleInput.value = task.title || '';
  taskDescriptionInput.value = task.description || '';
  taskSubmitBtn.textContent = 'Update Task';
  if (taskCancelBtn) taskCancelBtn.style.display = 'inline-block';
  if (formHeading) formHeading.textContent = `Edit Task #${task.id}`;
  taskTitleInput.focus();
}

/**
 * Reset form back to "Add New Task" mode
 */
function resetForm() {
  editingTaskId = null;
  taskForm.reset();
  taskSubmitBtn.textContent = 'Add Task';
  if (taskCancelBtn) taskCancelBtn.style.display = 'none';
  if (formHeading) formHeading.textContent = 'Add New Task';
}

// Event Listeners
taskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = taskTitleInput.value;
  const description = taskDescriptionInput.value;

  if (!title.trim()) {
    showStatus('Task title is required.', 'error');
    return;
  }

  if (editingTaskId !== null) {
    await updateTask(editingTaskId, title, description);
  } else {
    await createTask(title, description);
  }
});

if (taskCancelBtn) {
  taskCancelBtn.addEventListener('click', () => {
    resetForm();
    showStatus('Edit cancelled.', 'info', 2000);
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', async () => {
    showStatus('Refreshing tasks...', 'info', 1500);
    await fetchTasks();
  });
}

// Event delegation for task item buttons
taskListContainer.addEventListener('click', async (e) => {
  const target = e.target;
  const taskItem = target.closest('.task-item');
  if (!taskItem) return;

  const rawId = taskItem.getAttribute('data-id');
  const taskId = Number(rawId);
  const task = tasksCache.find(t => String(t.id) === String(rawId));

  if (target.classList.contains('toggle-task')) {
    if (!task) return;
    await toggleTaskStatus(taskId, Boolean(task.completed));
  } else if (target.classList.contains('edit-task')) {
    if (!task) return;
    startEditTask(task);
  } else if (target.classList.contains('delete-task')) {
    await deleteTask(taskId);
  }
});

// Initial boot
document.addEventListener('DOMContentLoaded', async () => {
  const config = await loadConfig();
  if (config) {
    showStatus('Connecting to Supabase...', 'info', 2000);
    await fetchTasks();
  }
});

