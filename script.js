// --- CONFIGURAÇÃO GITHUB (PREENCHA AQUI) ---
const GITHUB_CONFIG = {
    OWNER: 'MatheusFujimura1', // Seu usuário do GitHub
    REPO: 'InventarioOficial',   // <--- CORRIGIDO PARA O NOME REAL DO SEU REPO
    TOKEN: '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', // Seu token
    FILE_PATH: 'database.json',
    BRANCH: 'main' // ou 'master', dependendo de como criou
};

// --- SERVIÇO DE BANCO DE DADOS (GITHUB API) ---
const GithubDB = {
    sha: null, // Identificador da versão do arquivo (necessário para atualizar)
    data: null, // Dados em cache

    // Função auxiliar para codificar em Base64 (suporta UTF-8)
    toBase64: (str) => {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
            function toSolidBytes(match, p1) {
                return String.fromCharCode('0x' + p1);
        }));
    },

    // Ler dados do GitHub
    fetchData: async () => {
        try {
            const url = `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${GITHUB_CONFIG.FILE_PATH}?ref=${GITHUB_CONFIG.BRANCH}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${GITHUB_CONFIG.TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) throw new Error('Falha ao conectar com GitHub');

            const json = await response.json();
            GithubDB.sha = json.sha; // Guarda o SHA para o próximo update
            
            // Decodifica Base64 (suporta UTF-8)
            const decodedContent = decodeURIComponent(atob(json.content).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            GithubDB.data = JSON.parse(decodedContent);
            return GithubDB.data;
        } catch (error) {
            console.error('Erro ao ler DB:', error);
            alert('Erro ao carregar dados do GitHub. Verifique o console ou o Token.');
            return null;
        }
    },

    // Salvar dados no GitHub
    saveData: async (newData) => {
        if (!GithubDB.sha) {
            alert('Erro: SHA não encontrado. Recarregue a página.');
            return false;
        }

        ui.showLoading(true, 'Salvando na nuvem...');

        try {
            const content = JSON.stringify(newData, null, 2);
            const body = {
                message: `Update via App - ${new Date().toLocaleString()}`,
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

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message);
            }

            const json = await response.json();
            GithubDB.sha = json.content.sha; // Atualiza SHA
            GithubDB.data = newData; // Atualiza cache local
            return true;
        } catch (error) {
            console.error('Erro ao salvar:', error);
            alert('Erro ao salvar no GitHub: ' + error.message);
            return false;
        } finally {
            ui.showLoading(false);
        }
    }
};

// --- GERENCIAMENTO DE ESTADO LOCAL ---
// Wrapper para facilitar acesso aos dados já carregados
const DB = {
    getInventory: () => GithubDB.data ? GithubDB.data.inventory : [],
    getUsers: () => GithubDB.data ? GithubDB.data.users : [],
    
    // Atualiza o objeto completo e manda salvar
    update: async (key, value) => {
        if (!GithubDB.data) return;
        const newData = { ...GithubDB.data, [key]: value };
        const success = await GithubDB.saveData(newData);
        return success;
    }
};

// --- UTILS UI ---
const ui = {
    showLoading: (show, text = 'Carregando...') => {
        const el = document.getElementById('loading-overlay');
        const txt = document.getElementById('loading-text');
        if (show) {
            txt.innerText = text;
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
        }
    }
};

// --- AUTENTICAÇÃO ---

const auth = {
    user: null,
    
    init: () => {
        // Tenta recuperar sessão, mas valida com o GitHub
        const saved = sessionStorage.getItem('current_user');
        if (saved) {
            // Se tem sessão salva, precisamos carregar os dados do GitHub em background
            ui.showLoading(true, 'Conectando ao banco de dados...');
            GithubDB.fetchData().then(data => {
                ui.showLoading(false);
                if (data) {
                    auth.user = JSON.parse(saved);
                    app.init();
                } else {
                    document.getElementById('login-screen').classList.remove('hidden');
                }
            });
        } else {
            document.getElementById('login-screen').classList.remove('hidden');
        }
    },
    
    login: async (e) => {
        e.preventDefault();
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        
        ui.showLoading(true, 'Verificando credenciais...');
        
        // Carrega dados frescos do GitHub
        const data = await GithubDB.fetchData();
        ui.showLoading(false);

        if (!data) return; // Erro já tratado no fetchData

        const user = data.users.find(x => x.username === u && x.password === p);
        
        if (user) {
            auth.user = user;
            sessionStorage.setItem('current_user', JSON.stringify(user));
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('login-error').classList.add('hidden');
            app.init();
        } else {
            const err = document.getElementById('login-error');
            err.textContent = "Usuário ou senha incorretos.";
            err.classList.remove('hidden');
        }
    },
    
    logout: () => {
        sessionStorage.removeItem('current_user');
        location.reload();
    }
};

// --- ROTEADOR E UI ---

const router = {
    navigate: (view) => {
        document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('nav-btn-active', 'text-white'));
        
        document.getElementById(`view-${view}`).classList.remove('hidden');
        
        const btn = document.getElementById(`nav-${view}`);
        if(btn) {
            btn.classList.add('nav-btn-active');
            btn.classList.remove('text-slate-400');
        }

        const titles = {
            'dashboard': ['Dashboard', 'Métricas e Análises'],
            'import': ['Registro de Inventário', 'Importação e Cálculo de Divergências'],
            'list': ['Base de Materiais', 'Consulta Geral'],
            'users': ['Gestão de Usuários', 'Controle de Acesso da Equipe']
        };
        document.getElementById('page-title').innerText = titles[view][0];
        document.getElementById('page-subtitle').innerText = titles[view][1];

        if (view === 'dashboard') dashboard.render();
        if (view === 'list') inventory.renderTable();
        if (view === 'users') users.render();
    }
};

// --- LÓGICA DE INVENTÁRIO ---

let previewData = [];

const inventory = {
    processInput: () => {
        const getLines = (id) => document.getElementById(id).value.trim().split('\n');
        
        const codes = getLines('input-code');
        const descs = getLines('input-desc');
        const whs = getLines('input-wh');
        const saps = getLines('input-sap');
        const physs = getLines('input-phys');
        const vals = getLines('input-val');

        if (codes[0] === "") return alert("Cole os dados primeiro.");

        previewData = codes.map((code, i) => {
            if (!code) return null;
            
            const sapQ = parseFloat((saps[i] || '0').replace(',', '.'));
            const physQ = parseFloat((physs[i] || '0').replace(',', '.'));
            const rawVal = (vals[i] || '0').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
            const sapVal = parseFloat(rawVal) || 0;
            
            const unitVal = sapQ !== 0 ? sapVal / sapQ : 0;
            const divQ = physQ - sapQ;
            const divVal = divQ * unitVal;

            return {
                id: Date.now() + Math.random(),
                code: code.trim(),
                desc: descs[i] || '',
                wh: whs[i] || 'GERAL',
                sapQ,
                physQ,
                sapVal,
                divQ,
                divVal,
                date: new Date().toLocaleDateString()
            };
        }).filter(x => x !== null);

        inventory.renderPreview();
    },

    renderPreview: () => {
        document.getElementById('import-preview').classList.remove('hidden');
        const tbody = document.getElementById('preview-body');
        
        tbody.innerHTML = previewData.map(item => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-4 py-2 text-gray-800 font-medium">${item.code}</td>
                <td class="px-4 py-2 text-gray-500">${item.wh}</td>
                <td class="px-4 py-2 text-right text-gray-600">${item.sapQ}</td>
                <td class="px-4 py-2 text-right font-bold text-gray-800 bg-gray-50 border-l border-r">${item.physQ}</td>
                <td class="px-4 py-2 text-right font-bold ${item.divVal < 0 ? 'text-red-600' : item.divVal > 0 ? 'text-blue-600' : 'text-green-600'}">
                    ${item.divVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                </td>
            </tr>
        `).join('');
    },

    savePreview: async () => {
        const current = DB.getInventory();
        const success = await DB.update('inventory', [...current, ...previewData]);
        
        if (success) {
            inventory.clearPreview();
            document.querySelectorAll('.input-area').forEach(t => t.value = '');
            alert('Dados Salvos no GitHub com Sucesso!');
            if (auth.user.role === 'ADMIN') {
                router.navigate('list');
            }
        }
    },

    clearPreview: () => {
        previewData = [];
        document.getElementById('import-preview').classList.add('hidden');
    },

    renderTable: () => {
        const search = document.getElementById('search-input').value.toLowerCase();
        const data = DB.getInventory().filter(i => 
            i.code.toLowerCase().includes(search) || 
            i.desc.toLowerCase().includes(search) || 
            i.wh.toLowerCase().includes(search)
        );
        
        const tbody = document.getElementById('inventory-body');
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400">Nenhum item encontrado</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item => `
            <tr class="hover:bg-gray-50 transition-colors border-b last:border-0">
                <td class="px-4 py-3 font-medium text-gray-900">${item.code}</td>
                <td class="px-4 py-3 text-gray-500 truncate max-w-xs" title="${item.desc}">${item.desc}</td>
                <td class="px-4 py-3 text-gray-500">${item.wh}</td>
                <td class="px-4 py-3 text-right text-gray-600">${item.sapQ}</td>
                <td class="px-4 py-3 text-right font-bold text-gray-800 bg-gray-50">${item.physQ}</td>
                <td class="px-4 py-3 text-right font-bold ${item.divQ !== 0 ? 'text-red-600' : 'text-green-600'}">${item.divQ}</td>
                <td class="px-4 py-3 text-right font-bold ${item.divVal !== 0 ? (item.divVal < 0 ? 'text-red-600' : 'text-blue-600') : 'text-gray-400'}">
                    ${item.divVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
                </td>
                <td class="px-4 py-3 text-right">
                    <button onclick="inventory.deleteItem('${item.id}')" class="text-gray-400 hover:text-red-600 p-1 transition-colors"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `).join('');
        
        lucide.createIcons();
    },

    deleteItem: async (id) => {
        if(confirm('Excluir este item?')) {
            const data = DB.getInventory().filter(i => i.id != id); 
            const success = await DB.update('inventory', data);
            if (success) inventory.renderTable();
        }
    },

    clearAll: async () => {
        if(confirm('ATENÇÃO: Isso apagará TODO o banco de dados do GitHub. Confirmar?')) {
            const success = await DB.update('inventory', []);
            if (success) inventory.renderTable();
        }
    },

    exportCSV: () => {
        const data = DB.getInventory();
        let csv = "Material;Descricao;Deposito;Qtd SAP;Contagem;Divergencia Qtd;Divergencia Valor\n";
        data.forEach(row => {
            csv += `${row.code};${row.desc};${row.wh};${row.sapQ.toString().replace('.', ',')};${row.physQ.toString().replace('.', ',')};${row.divQ.toString().replace('.', ',')};${row.divVal.toFixed(2).replace('.', ',')}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'inventario_vertente.csv';
        a.click();
    }
};

// --- DASHBOARD ---

const dashboard = {
    chartInstance: null,
    
    render: () => {
        const data = DB.getInventory();
        
        const totalItems = data.length;
        const itemsOk = data.filter(i => i.divQ === 0).length;
        const accuracy = totalItems ? ((itemsOk / totalItems) * 100).toFixed(1) : 0;
        const totalDivVal = data.reduce((acc, curr) => acc + curr.divVal, 0);
        const totalSapVal = data.reduce((acc, curr) => acc + curr.sapVal, 0);

        document.getElementById('kpi-total').innerText = totalItems;
        document.getElementById('kpi-accuracy').innerText = accuracy + '%';
        document.getElementById('kpi-divergence').innerText = totalDivVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
        document.getElementById('kpi-sap-value').innerText = totalSapVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});

        const whMap = {};
        data.forEach(i => {
            const wh = i.wh || 'N/A';
            if (!whMap[wh]) whMap[wh] = 0;
            whMap[wh] += Math.abs(i.divVal);
        });

        const ctx = document.getElementById('chart-divergence').getContext('2d');
        if (dashboard.chartInstance) dashboard.chartInstance.destroy();

        dashboard.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(whMap),
                datasets: [{
                    label: 'Divergência Absoluta (R$)',
                    data: Object.values(whMap),
                    backgroundColor: '#0ea5e9',
                    borderRadius: 4,
                    barThickness: 40
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
};

// --- USUÁRIOS ---

const users = {
    render: () => {
        const list = DB.getUsers();
        const tbody = document.getElementById('users-body');
        
        tbody.innerHTML = list.map(u => `
            <tr class="hover:bg-gray-50 transition-colors">
                <td class="px-4 py-3 text-gray-900 font-medium">${u.name}</td>
                <td class="px-4 py-3 text-gray-500">${u.username}</td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 rounded-full text-xs font-bold ${u.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}">
                        ${u.role}
                    </span>
                </td>
                <td class="px-4 py-3 text-right">
                    ${u.username !== 'mvfujimura' && u.id !== auth.user.id 
                        ? `<button onclick="users.delete('${u.username}')" class="text-red-500 hover:bg-red-50 p-1 rounded transition-colors"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` 
                        : '<span class="text-xs text-gray-300">Bloqueado</span>'}
                </td>
            </tr>
        `).join('');
        lucide.createIcons();
    },

    add: async (e) => {
        e.preventDefault();
        const name = document.getElementById('new-user-name').value;
        const username = document.getElementById('new-user-login').value;
        const password = document.getElementById('new-user-pass').value;
        const role = document.getElementById('new-user-role').value;
        
        const current = DB.getUsers();
        
        if(current.find(u => u.username === username)) {
            alert('Este login já existe.');
            return;
        }

        const success = await DB.update('users', [...current, { id: Date.now(), name, username, password, role }]);
        
        if (success) {
            e.target.reset();
            users.render();
            alert('Usuário salvo no GitHub!');
        }
    },

    delete: async (username) => {
        if(confirm(`Remover o usuário ${username}?`)) {
            const current = DB.getUsers().filter(u => u.username !== username);
            const success = await DB.update('users', current);
            if (success) users.render();
        }
    }
};

// --- INICIALIZAÇÃO ---

const app = {
    init: () => {
        document.getElementById('app-screen').classList.remove('hidden');
        document.getElementById('user-name-display').innerText = auth.user.name;
        document.getElementById('user-role-display').innerText = auth.user.role === 'ADMIN' ? 'Administrador' : 'Balconista';
        document.getElementById('current-date').innerText = new Date().toLocaleDateString('pt-BR');
        
        if (auth.user.role !== 'ADMIN') {
            document.getElementById('nav-dashboard').classList.add('hidden');
            document.getElementById('nav-users').classList.add('hidden');
            document.getElementById('nav-list').classList.add('hidden');
            router.navigate('import');
        } else {
            router.navigate('dashboard');
        }
        
        lucide.createIcons();
    }
};

document.getElementById('login-form').addEventListener('submit', auth.login);

auth.init();
