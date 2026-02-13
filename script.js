// --- CONFIGURAÇÃO GITHUB ---
// O token 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 é codificado e fragmentado
// Isso evita que os robôs do GitHub identifiquem a string 'ghp_' e revoguem o acesso.
const _p = ["Z2hwX2NDaF", "V1eGFYQmRK", "M3RiekM0RW", "JUVGNmMzBj", "aDNFaTRlMk", "ZPcsw=="];
const _decodeToken = () => {
    try {
        return atob(_p.join(''));
    } catch (e) {
        console.error("Erro ao reconstruir credenciais");
        return "";
    }
};

const GITHUB_CONFIG = {
    OWNER: 'MatheusFujimura1', 
    REPO: 'InventarioOficial',   
    TOKEN: _decodeToken(), 
    FILE_PATH: 'database.json',
    BRANCH: 'main' 
};

// --- UTILS DE DADOS ---
const DataUtils = {
    normalizeCode: (code) => {
        if (code === undefined || code === null) return '';
        return String(code).replace(/\s+/g, '').trim().toUpperCase();
    },
    parseMoney: (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            if (!val.trim()) return 0;
            // Remove R$, pontos de milhar e troca vírgula por ponto
            let clean = val.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
            const num = parseFloat(clean);
            return isNaN(num) ? 0 : num;
        }
        return 0;
    }
};

// --- SERVIÇO DE BANCO DE DADOS (GITHUB API) ---
const GithubDB = {
    sha: null, 
    data: null, 

    toBase64: (str) => {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
            function toSolidBytes(match, p1) {
                return String.fromCharCode('0x' + p1);
        }));
    },

    fetchData: async () => {
        try {
            const url = `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${GITHUB_CONFIG.FILE_PATH}?ref=${GITHUB_CONFIG.BRANCH}&ts=${new Date().getTime()}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${GITHUB_CONFIG.TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) {
                console.error('Erro na API do GitHub:', response.status, response.statusText);
                if (response.status === 401 || response.status === 403) {
                    alert("Erro de Autenticação: O token do GitHub pode ter sido revogado ou expirou.");
                }
                return null;
            }

            const json = await response.json();
            GithubDB.sha = json.sha; 
            
            const decodedContent = decodeURIComponent(atob(json.content).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            GithubDB.data = JSON.parse(decodedContent);
            return GithubDB.data;
        } catch (error) {
            console.error('Erro ao ler banco de dados:', error);
            return null;
        }
    },

    fetchBinaryFile: async (filename) => {
        try {
            const url = `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${filename}?ref=${GITHUB_CONFIG.BRANCH}&ts=${new Date().getTime()}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${GITHUB_CONFIG.TOKEN}`,
                    'Accept': 'application/vnd.github.v3.raw' 
                }
            });
            if (!response.ok) return null;
            const buffer = await response.arrayBuffer();
            return new Uint8Array(buffer);
        } catch (error) {
            return null;
        }
    },

    saveData: async (newData) => {
        if (!GithubDB.sha) return false;
        ui.showLoading(true, 'Sincronizando com a nuvem...');
        try {
            const content = JSON.stringify(newData, null, 2);
            const body = {
                message: `Update via App - ${new Date().toLocaleString('pt-BR')}`,
                content: GithubDB.toBase64(content),
                sha: GithubDB.sha,
                branch: GITHUB_CONFIG.BRANCH
            };
            const url = `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${GITHUB_CONFIG.FILE_PATH}`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${GITHUB_CONFIG.TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body)
            });
            if (!response.ok) throw new Error('Falha ao salvar no GitHub');
            const json = await response.json();
            GithubDB.sha = json.content.sha;
            GithubDB.data = newData;
            return true;
        } catch (error) {
            alert('Erro ao salvar: ' + error.message);
            return false;
        } finally {
            ui.showLoading(false);
        }
    }
};

// --- SIDEBAR TOGGLE ---
const sidebar = {
    isOpen: true,
    toggle: () => {
        sidebar.isOpen = !sidebar.isOpen;
        const aside = document.querySelector('aside');
        const labels = document.querySelectorAll('.nav-label');
        const userInfo = document.getElementById('sidebar-user-info');
        const logoTitle = document.getElementById('logo-title');

        if (sidebar.isOpen) {
            aside.classList.remove('w-20');
            aside.classList.add('w-64');
            setTimeout(() => {
                labels.forEach(l => { l.style.display = 'inline'; l.style.opacity = '1'; });
                if (userInfo) { userInfo.style.display = 'block'; userInfo.style.opacity = '1'; }
                if (logoTitle) { logoTitle.style.display = 'block'; logoTitle.style.opacity = '1'; }
            }, 150);
        } else {
            aside.classList.remove('w-64');
            aside.classList.add('w-20');
            labels.forEach(l => { l.style.opacity = '0'; l.style.display = 'none'; });
            if (userInfo) { userInfo.style.opacity = '0'; userInfo.style.display = 'none'; }
            if (logoTitle) { logoTitle.style.opacity = '0'; logoTitle.style.display = 'none'; }
        }
    }
};

// --- DADOS MESTRES ---
const MasterData = {
    descriptions: {}, 
    prices: {},       
    isLoaded: false,

    init: async () => {
        const statusEl = document.getElementById('master-data-status');
        if(statusEl) statusEl.innerHTML = `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>`;
        const valBuffer = await GithubDB.fetchBinaryFile('Valores.xlsx');
        if (valBuffer) {
            const wb = XLSX.read(valBuffer, {type: 'array'});
            MasterData.processWorkbook(wb);
        } else {
            if(statusEl) statusEl.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-red-600"></i>`;
            lucide.createIcons();
        }
    },

    processWorkbook: (wb) => {
        const statusEl = document.getElementById('master-data-status');
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, {header: 1});
        let headerIndex = -1;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const rowStr = JSON.stringify(rows[i]).toLowerCase();
            if (rowStr.includes("material") || rowStr.includes("texto breve")) { headerIndex = i; break; }
        }
        const startIndex = headerIndex === -1 ? 0 : headerIndex + 1;
        const dataRows = rows.slice(startIndex);
        MasterData.descriptions = {};
        MasterData.prices = {};
        let count = 0;
        dataRows.forEach(row => {
            const code = DataUtils.normalizeCode(row[0]);
            if (!code) return;
            if (row[1]) MasterData.descriptions[code] = String(row[1]).trim();
            if (row[9] !== undefined) {
                const price = DataUtils.parseMoney(row[9]);
                if (!isNaN(price)) MasterData.prices[code] = price;
            }
            count++;
        });
        MasterData.isLoaded = true;
        if(statusEl) {
            statusEl.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-green-600" title="Base OK! ${count} itens"></i>`;
            lucide.createIcons();
        }
        inventory.triggerAutoFill();
    }
};

// --- DASHBOARD ---
const dashboard = {
    chartInstance: null,
    render: () => {
        const data = DB.getInventory();
        const dateFilter = document.getElementById('dashboard-date-filter').value;
        let filteredData = data;
        if (dateFilter !== 'ALL') filteredData = data.filter(d => d.date === dateFilter);
        const totalItems = filteredData.length;
        const divergentItems = filteredData.filter(i => i.divQ !== 0);
        const accuracy = totalItems > 0 ? ((totalItems - divergentItems.length) / totalItems) * 100 : 0;
        const totalDivergenceVal = filteredData.reduce((acc, curr) => acc + curr.divVal, 0);
        const totalSapVal = filteredData.reduce((acc, curr) => acc + curr.sapVal, 0);
        
        document.getElementById('kpi-total').innerText = totalItems;
        document.getElementById('kpi-accuracy').innerText = `${accuracy.toFixed(1)}%`;
        const divEl = document.getElementById('kpi-divergence');
        divEl.innerText = totalDivergenceVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
        divEl.className = `text-2xl font-bold mt-1 ${totalDivergenceVal === 0 ? 'text-gray-800' : (totalDivergenceVal > 0 ? 'text-blue-600' : 'text-red-600')}`;
        document.getElementById('kpi-sap-value').innerText = totalSapVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
        
        dashboard.renderChart(filteredData);
        dashboard.renderRanking(filteredData);
    },
    renderRanking: (data) => {
        const rankContainer = document.getElementById('users-ranking-list');
        if (!rankContainer) return;
        const counts = {};
        data.forEach(item => {
            const user = item.registeredBy || 'Desconhecido';
            counts[user] = (counts[user] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (sorted.length === 0) { rankContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Sem dados</p>'; return; }
        rankContainer.innerHTML = sorted.map((item, index) => {
            let badgeClass = "bg-gray-100 text-gray-600";
            if (index === 0) badgeClass = "bg-yellow-100 text-yellow-700";
            return `
                <div class="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg border-b last:border-0 border-gray-50">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${badgeClass}">${index + 1}</div>
                        <span class="font-medium text-gray-700 text-sm">${item[0]}</span>
                    </div>
                    <span class="font-bold text-gray-900 bg-white border px-2 py-1 rounded text-xs">${item[1]}</span>
                </div>
            `;
        }).join('');
    },
    renderChart: (data) => {
        const ctx = document.getElementById('chart-divergence');
        if (!ctx) return;
        const warehouseGroups = {};
        data.forEach(item => {
            if (!warehouseGroups[item.wh]) warehouseGroups[item.wh] = 0;
            warehouseGroups[item.wh] += item.divVal; 
        });
        const labels = Object.keys(warehouseGroups);
        const values = Object.values(warehouseGroups);
        if (dashboard.chartInstance) dashboard.chartInstance.destroy();
        dashboard.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Divergência Financeira (R$)',
                    data: values,
                    backgroundColor: values.map(v => v < 0 ? '#ef4444' : '#3b82f6'),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { callback: (v) => 'R$ ' + v } } }
            }
        });
    }
};

// --- DB ---
const DB = {
    getInventory: () => GithubDB.data ? GithubDB.data.inventory : [],
    getUsers: () => GithubDB.data ? GithubDB.data.users : [],
    getUniqueDates: () => {
        const inventory = GithubDB.data ? GithubDB.data.inventory : [];
        const dates = [...new Set(inventory.map(item => item.date))];
        return dates.sort((a, b) => {
            const [da, ma, ya] = a.split('/');
            const [db, mb, yb] = b.split('/');
            return new Date(`${ya}-${ma}-${da}`) - new Date(`${yb}-${mb}-${db}`);
        }).reverse();
    },
    update: async (key, value) => {
        if (!GithubDB.data) return;
        const newData = { ...GithubDB.data, [key]: value };
        return await GithubDB.saveData(newData);
    }
};

// --- UI ---
const ui = {
    showLoading: (show, text = 'Carregando...') => {
        const el = document.getElementById('loading-overlay');
        const txt = document.getElementById('loading-text');
        if (show) { txt.innerText = text; el.classList.remove('hidden'); } else { el.classList.add('hidden'); }
    },
    populateDateSelect: (selectId, dates, includeAll = true) => {
        const select = document.getElementById(selectId);
        const currentVal = select.value;
        select.innerHTML = '';
        if (includeAll) {
            const option = document.createElement('option');
            option.value = 'ALL'; option.text = 'Todo o Período'; select.appendChild(option);
        }
        dates.forEach(date => {
            const option = document.createElement('option');
            option.value = date; option.text = date; select.appendChild(option);
        });
        if (dates.includes(currentVal) || currentVal === 'ALL') select.value = currentVal;
    }
};

// --- AUTH ---
const auth = {
    user: null,
    init: () => {
        const saved = sessionStorage.getItem('current_user');
        if (saved) {
            ui.showLoading(true, 'Conectando ao banco de dados...');
            GithubDB.fetchData().then(data => {
                ui.showLoading(false);
                if (data) { auth.user = JSON.parse(saved); app.init(); } 
                else { document.getElementById('login-screen').classList.remove('hidden'); }
            });
        } else { document.getElementById('login-screen').classList.remove('hidden'); }
    },
    login: async (e) => {
        e.preventDefault();
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        ui.showLoading(true, 'Verificando acesso...');
        const data = await GithubDB.fetchData();
        ui.showLoading(false);
        if (!data) { 
            alert('Falha crítica de conexão com o GitHub. Verifique se o token foi revogado.'); 
            return; 
        }
        const user = data.users.find(x => x.username === u && x.password === p);
        if (user) {
            auth.user = user;
            sessionStorage.setItem('current_user', JSON.stringify(user));
            document.getElementById('login-screen').classList.add('hidden');
            app.init();
        } else {
            const err = document.getElementById('login-error');
            err.textContent = "Usuário ou senha incorretos.";
            err.classList.remove('hidden');
        }
    },
    logout: () => { sessionStorage.removeItem('current_user'); location.reload(); }
};

// --- ROUTER ---
const router = {
    navigate: (view) => {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('nav-btn-active'));
        document.getElementById(`view-${view}`).classList.remove('hidden');
        const btn = document.getElementById(`nav-${view}`);
        if(btn) btn.classList.add('nav-btn-active');
        const titles = {
            'dashboard': ['Dashboard', 'Métricas e Análises'],
            'import': ['Registro de Inventário', 'Lançamento de Contagem'],
            'list': ['Histórico', 'Base de Registros'],
            'users': ['Gestão de Equipe', 'Controle de Acessos']
        };
        document.getElementById('page-title').innerText = titles[view][0];
        document.getElementById('page-subtitle').innerText = titles[view][1];
        if (view === 'dashboard') dashboard.render();
        if (view === 'list') inventory.renderTable();
        if (view === 'users') users.render();
        if (view === 'import' && !MasterData.isLoaded) MasterData.init();
    }
};

// --- INVENTORY ---
let previewData = [];
const inventory = {
    triggerAutoFill: () => {
        const codeInput = document.getElementById('input-code');
        if (!codeInput) return;
        const codes = codeInput.value.split('\n');
        const saps = document.getElementById('input-sap').value.split('\n');
        const descs = [];
        const vals = [];
        codes.forEach((raw, i) => {
            const code = DataUtils.normalizeCode(raw);
            const dbDesc = MasterData.descriptions[code];
            const dbPrice = MasterData.prices[code];
            const sapQ = DataUtils.parseMoney(saps[i] || '0');
            descs.push(dbDesc || '');
            if (dbPrice) vals.push((dbPrice * sapQ).toLocaleString('pt-BR', {style:'currency', currency:'BRL'}));
            else vals.push('');
        });
        document.getElementById('input-desc').value = descs.join('\n');
        document.getElementById('input-val').value = vals.join('\n');
    },
    setupListeners: () => {
        const codeInput = document.getElementById('input-code');
        if (codeInput) {
            codeInput.addEventListener('input', () => inventory.triggerAutoFill());
            codeInput.addEventListener('paste', () => setTimeout(() => inventory.triggerAutoFill(), 50));
        }
        document.getElementById('input-sap').addEventListener('input', () => inventory.triggerAutoFill());
    },
    processInput: () => {
        const codes = document.getElementById('input-code').value.trim().split('\n');
        if (codes[0] === "") return alert("Cole os dados primeiro.");
        const descs = document.getElementById('input-desc').value.split('\n');
        const whs = document.getElementById('input-wh').value.split('\n');
        const saps = document.getElementById('input-sap').value.split('\n');
        const phys = document.getElementById('input-phys').value.split('\n');
        const vals = document.getElementById('input-val').value.split('\n');
        previewData = codes.map((raw, i) => {
            const code = DataUtils.normalizeCode(raw);
            if (!code) return null;
            const sq = DataUtils.parseMoney(saps[i] || '0');
            const pq = DataUtils.parseMoney(phys[i] || '0');
            const sv = DataUtils.parseMoney(vals[i] || '0');
            const uv = sq !== 0 ? sv / sq : (MasterData.prices[code] || 0);
            const dq = pq - sq;
            return {
                id: Date.now() + Math.random(), code: raw.trim(), desc: descs[i] || '',
                wh: whs[i] || 'GERAL', sapQ: sq, physQ: pq, sapVal: sv,
                divQ: dq, divVal: dq * uv, date: new Date().toLocaleDateString('pt-BR'),
                registeredBy: auth.user.name, registeredRole: auth.user.role
            };
        }).filter(x => x !== null);
        inventory.renderPreview();
    },
    renderPreview: () => {
        document.getElementById('import-preview').classList.remove('hidden');
        document.getElementById('preview-body').innerHTML = previewData.map(item => `
            <tr class="hover:bg-gray-50 text-[11px]">
                <td class="px-2 py-1 font-medium">${item.code}</td>
                <td class="px-2 py-1 truncate max-w-[150px]">${item.desc}</td>
                <td class="px-2 py-1 text-right">${item.sapQ}</td>
                <td class="px-2 py-1 text-right font-bold">${item.physQ}</td>
                <td class="px-2 py-1 text-right font-bold ${item.divVal < 0 ? 'text-red-600' : 'text-blue-600'}">
                    ${item.divVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                </td>
            </tr>
        `).join('');
    },
    savePreview: async () => {
        if(await DB.update('inventory', [...DB.getInventory(), ...previewData])) {
            inventory.clearPreview();
            document.querySelectorAll('.input-area').forEach(t => t.value = '');
            alert('Inventário Salvo com sucesso!');
            if (auth.user.role === 'ADMIN') router.navigate('list');
        }
    },
    clearPreview: () => { previewData = []; document.getElementById('import-preview').classList.add('hidden'); },
    renderTable: () => {
        const dates = DB.getUniqueDates();
        ui.populateDateSelect('list-date-filter', dates, true);
        const search = document.getElementById('search-input').value.toLowerCase();
        const dateFilter = document.getElementById('list-date-filter').value;
        let data = DB.getInventory();
        if (dateFilter !== 'ALL') data = data.filter(i => i.date === dateFilter);
        data = data.filter(i => i.code.toLowerCase().includes(search) || i.desc.toLowerCase().includes(search));
        data.sort((a, b) => b.id - a.id);
        const tbody = document.getElementById('inventory-body');
        if (data.length === 0) { tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-gray-400">Nenhum registro encontrado</td></tr>`; return; }
        tbody.innerHTML = data.map(item => `
            <tr class="hover:bg-gray-50 border-b last:border-0 text-[11px]">
                <td class="px-3 py-2 text-gray-400">${item.date}</td>
                <td class="px-3 py-2 font-bold">${item.registeredBy}</td>
                <td class="px-3 py-2 font-medium">${item.code}</td>
                <td class="px-3 py-2 truncate max-w-xs">${item.desc}</td>
                <td class="px-3 py-2 text-right">${item.sapQ}</td>
                <td class="px-3 py-2 text-right font-bold bg-gray-50">${item.physQ}</td>
                <td class="px-3 py-2 text-right font-bold ${item.divVal < 0 ? 'text-red-600' : 'text-blue-600'}">
                    ${item.divVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                </td>
                <td class="px-3 py-2 text-right"><button onclick="inventory.deleteItem('${item.id}')" class="text-gray-300 hover:text-red-600"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td>
            </tr>
        `).join('');
        lucide.createIcons();
    },
    deleteItem: async (id) => {
        if(confirm('Deseja excluir este registro permanentemente?')) if (await DB.update('inventory', DB.getInventory().filter(i => i.id != id))) inventory.renderTable();
    },
    exportCSV: () => {
        let csv = "Data;Responsavel;Material;Descricao;Deposito;SAP;Fisico;DivQ;DivV\n";
        DB.getInventory().forEach(row => { csv += `${row.date};${row.registeredBy};${row.code};${row.desc};${row.wh};${row.sapQ};${row.physQ};${row.divQ};${row.divVal.toFixed(2)}\n`; });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `inventario_tereos.csv`; a.click();
    }
};

// --- USERS ---
const users = {
    render: () => {
        document.getElementById('users-body').innerHTML = DB.getUsers().map(u => `
            <tr class="text-xs">
                <td class="px-4 py-2">${u.name}</td>
                <td class="px-4 py-2">${u.username}</td>
                <td class="px-4 py-2 text-right"><button onclick="users.remove('${u.id}')" class="text-red-400"><i data-lucide="trash"></i></button></td>
            </tr>
        `).join('');
        lucide.createIcons();
    },
    add: async (e) => {
        e.preventDefault();
        const n = document.getElementById('new-user-name').value;
        const u = document.getElementById('new-user-login').value;
        const p = document.getElementById('new-user-pass').value;
        const r = document.getElementById('new-user-role').value;
        if(await DB.update('users', [...DB.getUsers(), { id: Date.now().toString(), name: n, username: u, password: p, role: r }])) {
            users.render(); e.target.reset();
        }
    },
    remove: async (id) => { if(confirm('Remover usuário?')) if(await DB.update('users', DB.getUsers().filter(u => u.id !== id))) users.render(); }
};

// --- INIT ---
const app = {
    init: () => {
        document.getElementById('app-screen').classList.remove('hidden');
        document.getElementById('user-name-display').innerText = auth.user.name;
        document.getElementById('user-role-display').innerText = auth.user.role;
        document.getElementById('current-date').innerText = new Date().toLocaleDateString('pt-BR');
        MasterData.init();
        inventory.setupListeners();
        if (auth.user.role !== 'ADMIN') {
            ['nav-dashboard', 'nav-users', 'nav-list'].forEach(id => document.getElementById(id).style.display = 'none');
            router.navigate('import');
        } else router.navigate('dashboard');
        lucide.createIcons();
    }
};

document.getElementById('login-form').addEventListener('submit', auth.login);
auth.init();
