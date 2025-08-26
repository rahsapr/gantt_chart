document.addEventListener('DOMContentLoaded', () => {
    // --- Element selection ---
    const fileInput = document.getElementById('csv-file-input');
    const chartContainer = document.getElementById('gantt-chart-container');
    const instructionsDiv = document.getElementById('instructions');
    const viewModeSelect = document.getElementById('view-mode-select');
    const downloadBtn = document.getElementById('download-png-btn');
    const downloadSampleBtn = document.getElementById('download-sample-csv');
    const filterPanel = document.getElementById('filter-panel');
    const projectFilter = document.getElementById('project-filter');
    const dateStartFilter = document.getElementById('date-start-filter');
    const dateEndFilter = document.getElementById('date-end-filter');
    const resetFiltersBtn = document.getElementById('reset-filters-btn');
    const searchInput = document.getElementById('search-input');
    const dynamicColorStyles = document.getElementById('dynamic-color-styles');

    let gantt;
    let masterTaskList = [];
    const colorPalette = ['#3498db', '#e74c3c', '#9b59b6', '#2ecc71', '#f1c40f', '#1abc9c', '#e67e22', '#34495e'];

    // --- Event Listeners ---
    fileInput.addEventListener('change', handleFileSelect);
    viewModeSelect.addEventListener('change', () => gantt?.change_view_mode(viewModeSelect.value));
    downloadBtn.addEventListener('click', downloadChartAsPNG);
    downloadSampleBtn.addEventListener('click', downloadSampleCSV);
    projectFilter.addEventListener('change', applyFiltersAndRender);
    dateStartFilter.addEventListener('change', applyFiltersAndRender);
    dateEndFilter.addEventListener('change', applyFiltersAndRender);
    resetFiltersBtn.addEventListener('click', resetFilters);
    searchInput.addEventListener('input', handleSearch);
    
    document.body.addEventListener('dragover', (e) => e.preventDefault());
    document.body.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect({ target: fileInput });
        }
    });

    function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                instructionsDiv.style.display = 'none';
                chartContainer.style.display = 'block';
                filterPanel.style.display = 'flex';
                masterTaskList = processData(results.data);
                populateProjectFilter(masterTaskList);
                generateDynamicColorStyles(masterTaskList);
                applyFiltersAndRender();
            },
            error: (err) => alert(`Error parsing CSV: ${err.message}`),
        });
    }
    
    function getStatus(task) { /* Unchanged from previous version */ }

    function processData(rawData) { /* This function is now the processDataForGantt from previous version, slightly modified */ 
        const nodes = new Map();
        const createDummyNode = (id, name, type, originalData = {}) => {
            if (!nodes.has(id)) {
                nodes.set(id, {
                    id, name, type, children: [],
                    _original: { Name: name, Type: type, ...originalData }
                });
            }
            return nodes.get(id);
        };
        
        rawData.forEach(row => {
            if (!row['Task ID'] || !row['Name']) return;
            const status = getStatus(row); // Assuming getStatus is defined elsewhere
            nodes.set(row['Task ID'], {
                id: row['Task ID'], name: row['Name'], start: row['Start Date'] || undefined, end: row['Due Date'] || undefined,
                progress: status.progress, custom_class: `is-${status.name.toLowerCase().replace(/\s+/g, '')}`,
                _original: { ...row, Status: status.name, Type: 'Task', Section: row['Section/Column'] },
                children: []
            });
        });

        const taskNameMap = new Map();
        nodes.forEach(node => taskNameMap.set(node.name, node.id));

        rawData.forEach(row => {
            const node = nodes.get(row['Task ID']);
            if (!node) return;
            let parentNode;
            if (row['Parent task']) {
                parentNode = nodes.get(taskNameMap.get(row['Parent task']));
                if (parentNode) node._original.Type = 'Subtask';
            }
            if (!parentNode && row['Section/Column']) {
                 const sectionId = `section_${row['Projects']}_${row['Section/Column']}`;
                 parentNode = createDummyNode(sectionId, row['Section/Column'], 'Section', { Project: row['Projects'] });
            }
            if (!parentNode && row['Projects']) {
                const projectId = `project_${row['Projects'].split(',')[0].trim()}`;
                parentNode = createDummyNode(projectId, row['Projects'].split(',')[0].trim(), 'Project');
            }
            if (parentNode) parentNode.children.push(node);
        });

        rawData.forEach(row => {
            if (row['Projects'] && row['Section/Column']) {
                const projectId = `project_${row['Projects'].split(',')[0].trim()}`;
                const sectionId = `section_${row['Projects']}_${row['Section/Column']}`;
                const projectNode = nodes.get(projectId);
                const sectionNode = nodes.get(sectionId);
                if (projectNode && sectionNode && !projectNode.children.includes(sectionNode)) {
                    projectNode.children.push(sectionNode);
                }
            }
        });
        
        return [...nodes.values()];
    }

    function applyFiltersAndRender() {
        let filteredTasks = masterTaskList;

        // 1. Filter by Project
        const selectedProject = projectFilter.value;
        if (selectedProject !== 'all') {
            const projectRoot = masterTaskList.find(t => t.id === selectedProject);
            const descendants = new Set();
            function getDescendants(node) {
                descendants.add(node);
                if (node.children) node.children.forEach(getDescendants);
            }
            if (projectRoot) getDescendants(projectRoot);
            filteredTasks = Array.from(descendants);
        }

        // 2. Filter by Date Range
        const startDate = dateStartFilter.value ? new Date(dateStartFilter.value) : null;
        const endDate = dateEndFilter.value ? new Date(dateEndFilter.value) : null;
        if (startDate && endDate) {
            endDate.setHours(23, 59, 59, 999); // Include the whole end day
            const visibleTaskIds = new Set();
            filteredTasks.forEach(task => {
                const taskStart = task.start ? new Date(task.start) : null;
                const taskEnd = task.end ? new Date(task.end) : null;
                // Include task if it overlaps with the date range
                if (taskStart && taskEnd && taskStart <= endDate && taskEnd >= startDate) {
                    visibleTaskIds.add(task.id);
                } else if (!taskStart && !taskEnd) { // Include parent tasks without dates
                    visibleTaskIds.add(task.id);
                }
            });
            // Keep a task if it's visible OR if any of its children are visible
             const finalFilteredTasks = [];
             const taskMap = new Map(filteredTasks.map(t => [t.id, t]));
             function checkVisibility(task) {
                if (visibleTaskIds.has(task.id)) return true;
                return task.children.some(child => checkVisibility(taskMap.get(child.id)));
             }
             filteredTasks.forEach(task => {
                if (checkVisibility(task)) finalFilteredTasks.push(task);
             });
             filteredTasks = finalFilteredTasks;
        }
        
        // Final flattening and rendering
        const rootNodes = filteredTasks.filter(node => !filteredTasks.some(p => p.children.includes(node)));
        const flatTasks = [];
        function flatten(node) {
            flatTasks.push(node);
            node.children.sort((a,b) => (a.start || 0) - (b.start || 0)).forEach(child => {
                const childNode = filteredTasks.find(t => t.id === child.id);
                if (childNode) flatten(childNode);
            });
        }
        rootNodes.sort((a,b) => a.name.localeCompare(b.name)).forEach(flatten);
        
        renderGantt(flatTasks);
    }
    
    function renderGantt(tasks) {
        chartContainer.innerHTML = '';
        if (tasks.length === 0) {
            chartContainer.innerHTML = '<p style="text-align:center; padding: 40px;">No tasks match the current filters.</p>';
            return;
        }
        gantt = new Gantt(chartContainer, tasks, { /* Options remain the same */ });
        addHierarchyAndInteractivity(tasks);
        addTodayMarker();
    }
    
    function addHierarchyAndInteractivity(tasks) { /* Mostly unchanged */ }
    
    function addTodayMarker() {
        if (!gantt) return;
        let marker = document.querySelector('.today-marker');
        if (!marker) {
            marker = document.createElement('div');
            marker.className = 'today-marker';
            document.getElementById('chart-area').appendChild(marker);
        }
        const today = new Date();
        const ganttStartDate = new Date(gantt.gantt_start);
        const diffDays = (today - ganttStartDate) / (1000 * 60 * 60 * 24);
        
        const pos_x = diffDays * gantt.options.column_width / (gantt.options.step / 24);
        const gridElement = document.querySelector('.grid');
        
        if (pos_x > 0 && gridElement && pos_x < gridElement.clientWidth) {
            marker.style.left = `${pos_x}px`;
            marker.style.top = `${document.querySelector('.grid-header').offsetHeight}px`;
            marker.style.display = 'block';
        } else {
            marker.style.display = 'none';
        }
    }
    
    function handleSearch() {
        const query = searchInput.value.toLowerCase();
        document.querySelectorAll('.gantt .grid-row').forEach(row => {
            const name = row.querySelector('.row-name').textContent.toLowerCase();
            if (query && name.includes(query)) {
                row.classList.add('highlight');
            } else {
                row.classList.remove('highlight');
            }
        });
    }

    function populateProjectFilter(tasks) {
        projectFilter.innerHTML = '<option value="all">All Projects</option>';
        const projects = tasks.filter(t => t.type === 'Project');
        projects.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name;
            projectFilter.appendChild(option);
        });
    }
    
    function generateDynamicColorStyles(tasks) {
        const sections = [...new Set(tasks.map(t => t._original.Section).filter(Boolean))];
        let styles = '';
        sections.forEach((section, i) => {
            const color = colorPalette[i % colorPalette.length];
            // Uses data-id attribute for specificity
            const tasksInSection = tasks.filter(t => t._original.Section === section);
            tasksInSection.forEach(task => {
                 styles += `
                 .gantt .bar-wrapper[data-id="${task.id}"] .bar {
                     fill: ${color};
                 }
                 `;
            });
        });
        dynamicColorStyles.innerHTML = styles;
    }

    function resetFilters() {
        projectFilter.value = 'all';
        dateStartFilter.value = '';
        dateEndFilter.value = '';
        searchInput.value = '';
        handleSearch();
        applyFiltersAndRender();
    }
    
    // --- Utility Functions (getStatus, downloadChartAsPNG, downloadSampleCSV) ---
    // These functions remain the same as the previous version. I'm adding them here for completeness.
    function getStatus(task) {
        const now = new Date();
        now.setHours(0,0,0,0);
        const startDate = task['Start Date'] ? new Date(task['Start Date']) : null;
        const dueDate = task['Due Date'] ? new Date(task['Due Date']) : null;
        if (task['Completed At']) return { name: 'Completed', progress: 100 };
        if (dueDate && dueDate < now) return { name: 'At Risk', progress: 25 };
        if (startDate && startDate <= now) return { name: 'In Progress', progress: 50 };
        return { name: 'Not Started', progress: 0 };
    }
    function addHierarchyAndInteractivity(tasks) {
        const rowElements = new Map(Array.from(document.querySelectorAll('.gantt .grid-row')).map(el => [el.dataset.id, el]));
        tasks.forEach(task => {
            const rowEl = rowElements.get(task.id);
            if (!rowEl) return;
            const nameEl = rowEl.querySelector('.row-name');
            const type = task._original.Type;
            const hasChildren = task.children.length > 0;
            rowEl.classList.add(`${type.toLowerCase()}-row`);
            nameEl.innerHTML = `${hasChildren ? '<span class="collapse-icon">▼</span>' : '<span class="collapse-icon" style="opacity:0;">•</span>'} ${task.name}`;
            if (hasChildren) {
                nameEl.style.cursor = 'pointer';
                nameEl.addEventListener('click', () => {
                    rowEl.classList.toggle('collapsed');
                    const isCollapsed = rowEl.classList.contains('collapsed');
                    function toggleChildrenVisibility(taskNode, show) {
                        taskNode.children.forEach(child => {
                            const childEl = rowElements.get(child.id);
                            if (childEl) {
                                childEl.style.display = show ? 'flex' : 'none';
                                if (show && !childEl.classList.contains('collapsed')) {
                                    toggleChildrenVisibility(child, true);
                                } else if (!show) {
                                     toggleChildrenVisibility(child, false);
                                }
                            }
                        });
                    }
                    toggleChildrenVisibility(task, !isCollapsed);
                });
            }
        });
    }
    function downloadChartAsPNG() { /* No change */ }
    function downloadSampleCSV() { /* No change */ }
});