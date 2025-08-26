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
    const popupEl = document.getElementById('global-task-popup');

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
    
    function processData(rawData) {
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
            const status = getStatus(row);
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
        let tasksToRender = masterTaskList;
        const selectedProject = projectFilter.value;
        if (selectedProject !== 'all') {
            const projectRoot = masterTaskList.find(t => t.id === selectedProject);
            const descendants = new Set();
            function getDescendants(node) {
                if (!node) return;
                descendants.add(node);
                node.children.forEach(childNode => getDescendants(masterTaskList.find(t => t.id === childNode.id)));
            }
            if (projectRoot) getDescendants(projectRoot);
            tasksToRender = Array.from(descendants);
        }
        const startDate = dateStartFilter.value ? new Date(dateStartFilter.value) : null;
        const endDate = dateEndFilter.value ? new Date(dateEndFilter.value) : null;
        if (startDate || endDate) {
            const visibleTaskIds = new Set();
            tasksToRender.forEach(task => {
                const taskStart = task.start ? new Date(task.start) : null;
                const taskEnd = task.end ? new Date(task.end) : null;
                const effectiveStart = startDate || new Date('1970-01-01');
                const effectiveEnd = endDate || new Date('2999-12-31');
                effectiveEnd.setHours(23, 59, 59, 999);
                if ((taskStart && taskEnd && taskStart <= effectiveEnd && taskEnd >= effectiveStart) || (!task.start && !task.end)) {
                    visibleTaskIds.add(task.id);
                }
            });
            tasksToRender = tasksToRender.filter(task => {
                if (visibleTaskIds.has(task.id)) return true;
                function checkChildren(node) {
                    if (!node) return false;
                    return node.children.some(child => {
                        if (visibleTaskIds.has(child.id)) return true;
                        return checkChildren(masterTaskList.find(t => t.id === child.id));
                    });
                }
                return checkChildren(task);
            });
        }
        const rootNodes = tasksToRender.filter(node => !tasksToRender.some(p => p.children.includes(node)));
        const flatTasks = [];
        function flatten(node) {
            flatTasks.push(node);
            node.children.sort((a, b) => (a.start || 'z').localeCompare(b.start || 'z')).forEach(child => {
                const childNode = tasksToRender.find(t => t.id === child.id);
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
            let marker = document.querySelector('.today-marker');
            if (marker) marker.style.display = 'none';
            return;
        }
        gantt = new Gantt(chartContainer, tasks, {});
        postRenderSetup(tasks);
    }

    function postRenderSetup(tasks) {
        addHierarchyAndInteractivity(tasks);
        addTodayMarker();
        setupCustomPopupEvents(tasks);
    }

    function setupCustomPopupEvents(tasks) {
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        
        document.querySelectorAll('.gantt .bar-wrapper').forEach(bar => {
            bar.addEventListener('mouseenter', (e) => {
                const taskId = bar.dataset.id;
                const task = taskMap.get(taskId);
                if (!task) return;

                const o = task._original;
                const statusClass = `is-${o.Status.toLowerCase().replace(/\s+/g, '')}`;
                let html = `<h4>${o.Name}</h4>`;
                html += `<p><strong>Status:</strong> <span class="popup-status ${statusClass}">${o.Status}</span></p>`;
                if (o.Assignee) html += `<p><strong>Assignee:</strong> ${o.Assignee}</p>`;
                html += `<p><strong>Dates:</strong> ${o['Start Date'] || 'TBD'} to ${o['Due Date'] || 'TBD'}</p>`;
                if (o.Projects) html += `<p><strong>Project:</strong> ${o.Projects}</p>`;
                if (o['Section/Column']) html += `<p><strong>Section:</strong> ${o['Section/Column']}</p>`;
                html += `<hr>`;
                const ignoreKeys = ['Name', 'Status', 'Assignee', 'Start Date', 'Due Date', 'Projects', 'Section/Column', 'Task ID', 'Type', 'Section'];
                for (const key in o) {
                    if (!ignoreKeys.includes(key) && o[key]) {
                        html += `<p><strong>${key}:</strong> ${o[key]}</p>`;
                    }
                }
                popupEl.innerHTML = html;
                popupEl.style.left = `${e.pageX + 15}px`;
                popupEl.style.top = `${e.pageY + 15}px`;
                popupEl.classList.add('visible');
            });

            bar.addEventListener('mouseleave', () => {
                popupEl.classList.remove('visible');
            });

            bar.addEventListener('mousemove', (e) => {
                 popupEl.style.left = `${e.pageX + 15}px`;
                 popupEl.style.top = `${e.pageY + 15}px`;
            });
        });
    }
    
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
            row.classList.toggle('highlight', query && name.includes(query));
        });
    }

    function populateProjectFilter(tasks) {
        projectFilter.innerHTML = '<option value="all">All Projects</option>';
        const projects = tasks.filter(t => t._original.Type === 'Project');
        projects.sort((a,b) => a.name.localeCompare(b.name)).forEach(p => {
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
            const sectionClass = `section-color-${i}`;
            styles += `.${sectionClass} .bar { fill: ${color}; }`;
        });
        dynamicColorStyles.innerHTML = styles;
        const sectionMap = new Map(sections.map((sec, i) => [sec, `section-color-${i}`]));
        tasks.forEach(task => {
            if (task._original.Section) {
                task.custom_class = (task.custom_class || '') + ' ' + sectionMap.get(task._original.Section);
            }
        });
    }

    function resetFilters() {
        projectFilter.value = 'all';
        dateStartFilter.value = '';
        dateEndFilter.value = '';
        searchInput.value = '';
        handleSearch();
        applyFiltersAndRender();
    }
    
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
            const hasChildren = task.children && task.children.length > 0;
            rowEl.classList.add(`${type.toLowerCase()}-row`);
            nameEl.innerHTML = `${hasChildren ? '<span class="collapse-icon">▼</span>' : '<span class="collapse-icon" style="opacity:0;">•</span>'} ${task.name}`;
            if (hasChildren) {
                nameEl.style.cursor = 'pointer';
                nameEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    rowEl.classList.toggle('collapsed');
                    const isCollapsed = rowEl.classList.contains('collapsed');
                    const taskMap = new Map(tasks.map(t => [t.id, t]));
                    function toggleChildrenVisibility(taskNode, show) {
                        if (!taskNode || !taskNode.children) return;
                        taskNode.children.forEach(childRef => {
                            const childNode = taskMap.get(childRef.id);
                            const childEl = rowElements.get(childRef.id);
                            if (childEl) {
                                childEl.style.display = show ? 'flex' : 'none';
                                if (show && !childEl.classList.contains('collapsed')) {
                                    toggleChildrenVisibility(childNode, true);
                                } else if (!show) {
                                     toggleChildrenVisibility(childNode, false);
                                }
                            }
                        });
                    }
                    toggleChildrenVisibility(task, !isCollapsed);
                });
            }
        });
    }

    function downloadChartAsPNG() {
        popupEl.classList.remove('visible');
        if (!gantt) { alert('Please upload a CSV file first.'); return; }
        const chartElement = document.querySelector('.gantt-container');
        html2canvas(chartElement, { backgroundColor: '#f4f7f9', logging: false, useCORS: true }).then(canvas => {
            const link = document.createElement('a');
            link.download = 'gantt-chart.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        });
    }

    function downloadSampleCSV() {
        const csvContent = `Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects,Parent task,Blocked By (Dependencies),Blocking (Dependencies)
101,2025-08-20,,2025-08-20,ACME - Project Launch,Launch Readiness,,,,,,High Priority,"A top-level project.",,,
102,2025-08-21,,2025-08-22,Marketing Strategy,Marketing,Jane Doe,jane@acme.com,2025-09-01,2025-10-15,,,ACME - Project Launch,,
103,2025-08-22,,2025-08-23,Develop Ad Campaign,Marketing,John Smith,john@acme.com,2025-09-05,2025-09-20,,,ACME - Project Launch,Marketing Strategy,
104,2025-08-23,2025-09-30,2025-09-30,Finalize Budget,Finance,Alice,alice@acme.com,2025-09-01,2025-09-15,finance,,"ACME - Project Launch",,
105,2025-08-24,,2025-08-25,Technical Setup,Engineering,,eng@acme.com,2025-09-10,2025-11-01,,,ACME - Project Launch,,
106,2025-08-25,,2025-08-26,Deploy Servers,Engineering,Bob,bob@acme.com,2025-09-15,2025-09-25,,,ACME - Project Launch,Technical Setup,
201,2025-08-26,,2025-08-27,Website Redesign,Web Team,,,,,,,"Another top-level project.",,,
202,2025-08-27,,2025-08-28,Homepage Mockup,Web Team,Charlie,charlie@acme.com,2025-10-01,2025-10-20,,,Website Redesign,`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.setAttribute("download", "gantt_chart_sample.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
});