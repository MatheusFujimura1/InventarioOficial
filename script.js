// --- CONFIGURAÇÃO GITHUB (PREENCHA AQUI) ---
const GITHUB_CONFIG = {
    OWNER: 'MatheusFujimura1', // Seu usuário do GitHub
    REPO: 'InventarioOficial',   // O nome exato do seu repositório
    TOKEN: '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', // Seu token
    FILE_PATH: 'database.json',
    BRANCH: 'main' // ou 'master', dependendo de como criou
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

    // Ler dados JSON do GitHub
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
            GithubDB.sha = json.sha; 
            
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

    // Buscar arquivo binário (Excel) do GitHub
    fetchBinaryFile: async (filename) => {
        try {
            const url = `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${filename}?ref=${GITHUB_CONFIG.BRANCH}`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${GITHUB_CONFIG.TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) return null;

            const json = await response.json();
            // Converter Base64 para ArrayBuffer
            const binaryString = atob(json.content.replace(/\s/g, ''));
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        } catch (error) {
            console.error(`Erro ao baixar ${filename}:`, error);
            return null;
        }
    },

    saveData: async (newData) => {
        if (!GithubDB.sha) {
            alert('Erro: SHA não encontrado. Recarregue a página.');
            return false;
        }

        ui.showLoading(true, 'Salvando na nuvem...');

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

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.message);
            }

            const json = await response.json();
            GithubDB.sha = json.content.sha;
            GithubDB.data = newData;
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

// --- DADOS MESTRES (EXCEL) ---
const MasterData = {
    descriptions: {}, // Mapa: Código -> Descrição
    prices: {},       // Mapa: Código -> Preço Unitário
    isLoaded: false,

    init: async () => {
        if (MasterData.isLoaded) return;
        
        const statusEl = document.getElementById('master-data-status');
        if(statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.innerHTML = `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div><span class="text-gray-600">Baixando BaseTanabi.xlsx e Valores.xlsx...</span>`;
        }

        // 1. Carregar Descrições (BaseTanabi.xlsx)
        const baseBuffer = await GithubDB.fetchBinaryFile('BaseTanabi.xlsx');
        if (baseBuffer) {
            const wb = XLSX.read(baseBuffer, {type: 'array'});
            const ws = wb.Sheets[wb.SheetNames[0]];
            // Ler Coluna A (Código) e B (Texto Breve)
            const rows = XLSX.utils.sheet_to_json(ws, {header: 1}); // Array de Arrays
            rows.forEach(row => {
                if (row[0] === undefined) return;
                // FORÇA CONVERSÃO PARA STRING PARA GARANTIR O MATCH
                const code = String(row[0]).trim(); 
                const desc = row[1]; // Coluna B
                if (code) MasterData.descriptions[code] = desc;
            });
            console.log('BaseTanabi carregada:', Object.keys(MasterData.descriptions).length, 'itens.');
        }

        // 2. Carregar Preços (Valores.xlsx)
        const valBuffer = await GithubDB.fetchBinaryFile('Valores.xlsx');
        if (valBuffer) {
            const wb = XLSX.read(valBuffer, {type: 'array'});
            const ws = wb.Sheets[wb.SheetNames[0]];
            // Ler Coluna A (Código) e J (Indice 9 - Valor)
            const rows = XLSX.utils.sheet_to_json(ws, {header: 1});
            rows.forEach(row => {
                if (row[0] === undefined) return;
                // FORÇA CONVERSÃO PARA STRING
                const code = String(row[0]).trim();
                const priceRaw = row[9]; // Coluna J (Indice 9)
                let price = 0;
                
                if (typeof priceRaw === 'number') {
                    price = priceRaw;
                } else if (typeof priceRaw === 'string') {
                    // Limpeza pesada para garantir que vire número: remove R$, remove pontos de milhar, troca virgula decimal por ponto
                    // Ex: "R$ 1.500,20" -> "1500.20"
                    const cleanStr = priceRaw.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
                    price = parseFloat(cleanStr);
                }
                
                if (code && !isNaN(price)) MasterData.prices[code] = price;
            });
            console.log('Valores carregada:', Object.keys(MasterData.prices).length, 'itens.');
        }

        MasterData.isLoaded = true;
        if(statusEl) {
            statusEl.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-green-600"></i><span class="text-green-700 font-medium">Bases de dados carregadas! Pode digitar.</span>`;
            lucide.createIcons();
            
            // Tenta rodar o autofill caso o usuário já tenha colado algo antes de carregar
            inventory.triggerAutoFill();
        }
    }
};

// --- GERENCIAMENTO DE ESTADO LOCAL ---
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
    },
    populateDateSelect: (selectId, dates, includeAll = true) => {
        const select = document.getElementById(selectId);
        const currentVal = select.value;
        
        select.innerHTML = '';
        if (includeAll) {
            const option = document.createElement('option');
            option.value = 'ALL';
            option.text = 'Todo o Período';
            select.appendChild(option);
        }

        dates.forEach(date => {
            const option = document.createElement('option');
            option.value = date;
            option.text = date;
            select.appendChild(option);
        });

        if (dates.includes(currentVal) || currentVal === 'ALL') {
            select.value = currentVal;
        }
    }
};

// --- AUTENTICAÇÃO ---
const auth = {
    user: null,
    
    init: () => {
        const saved = sessionStorage.getItem('current_user');
        if (saved) {
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
        
        const data = await GithubDB.fetchData();
        ui.showLoading(false);

        if (!data) return;

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
        
        // Se for para import, tenta carregar MasterData se ainda não carregou
        if (view === 'import') MasterData.init();
    }
};

// --- LÓGICA DE INVENTÁRIO ---
let previewData = [];

const inventory = {
    // Função separada para ser chamada no evento e na inicialização
    triggerAutoFill: () => {
        if (!MasterData.isLoaded) return;
        
        const codeInput = document.getElementById('input-code');
        const sapInput = document.getElementById('input-sap');
        const descInput = document.getElementById('input-desc');
        const valInput = document.getElementById('input-val');

        if (!codeInput) return;

        const codes = codeInput.value.split('\n');
        const saps = sapInput.value.split('\n');
        
        // Reconstroi as descrições
        const newDescs = codes.map((codeRaw, i) => {
            const code = codeRaw.trim();
            if(!code) return '';
            // Procura exato match
            return MasterData.descriptions[code] || '';
        });

        // Reconstroi os valores
        const newVals = codes.map((codeRaw, i) => {
            const code = codeRaw.trim();
            if(!code) return '';
            
            // Pega quantidade (Se vazio ou inválido, assume 0 para não gerar valor fantasma, ou 1 se preferir padrão)
            const qtyStr = saps[i] ? saps[i].replace(',', '.') : '0';
            let qty = parseFloat(qtyStr);
            if (isNaN(qty)) qty = 0; // Se não tem quantidade, valor total é 0
            
            // Pega preço unitário
            const unitPrice = MasterData.prices[code];
            
            if (unitPrice && !isNaN(unitPrice)) {
                const total = unitPrice * qty;
                return total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
            }
            return '';
        });

        // Atualiza os campos de Texto e Valor
        descInput.value = newDescs.join('\n');
        valInput.value = newVals.join('\n');
    },

    setupListeners: () => {
        // Adiciona ouvintes para reagir à digitação IMEDIATAMENTE (input)
        const codeInput = document.getElementById('input-code');
        const sapInput = document.getElementById('input-sap');

        if (codeInput) {
            codeInput.addEventListener('input', inventory.triggerAutoFill);
            // Também dispara se colar dados
            codeInput.addEventListener('paste', () => setTimeout(inventory.triggerAutoFill, 100)); 
        }
        
        if (sapInput) {
            sapInput.addEventListener('input', inventory.triggerAutoFill);
        }
    },

    processInput: () => {
        const getLines = (id) => document.getElementById(id).value.trim().split('\n');
        
        const codes = getLines('input-code');
        const descs = getLines('input-desc');
        const whs = getLines('input-wh');
        const saps = getLines('input-sap');
        const physs = getLines('input-phys');
        const vals = getLines('input-val');

        if (codes[0] === "") return alert("Cole os dados primeiro (Pelo menos o código).");

        previewData = codes.map((codeRaw, i) => {
            if (!codeRaw) return null;
            const code = codeRaw.trim();
            
            // 1. Descrição: Prioridade para o que está na caixa de texto (que foi preenchida pelo autoFill)
            // Se estiver vazio, tenta buscar de novo no MasterData por segurança
            let description = descs[i] ? descs[i].trim() : '';
            if ((!description || description === '') && MasterData.descriptions[code]) {
                description = MasterData.descriptions[code];
            }

            // 2. Quantidades
            const sapQ = parseFloat((saps[i] || '0').replace(',', '.'));
            const physQ = parseFloat((physs[i] || '0').replace(',', '.'));
            
            // 3. Valor Total SAP: Usa o digitado/calculado na tela
            let rawVal = (vals[i] || '').trim();
            let sapVal = 0;

            if (rawVal) {
                // Remove R$ e converte para float
                sapVal = parseFloat(rawVal.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
            } else {
                // Fallback: tenta calcular se estiver vazio
                const unitPrice = MasterData.prices[code];
                if (unitPrice && !isNaN(unitPrice)) {
                    sapVal = sapQ * unitPrice;
                }
            }
            
            const unitVal = sapQ !== 0 ? sapVal / sapQ : 0;
            const divQ = physQ - sapQ;
            const divVal = divQ * unitVal;

            return {
                id: Date.now() + Math.random(),
                code: code,
                desc: description,
                wh: whs[i] || 'GERAL',
                sapQ,
                physQ,
                sapVal,
                divQ,
                divVal,
                date: new Date().toLocaleDateString('pt-BR'),
                // NOVOS CAMPOS: REGISTRO DE USUÁRIO (NOME E CARGO)
                registeredBy: auth.user.name,
                registeredRole: auth.user.role === 'ADMIN' ? 'Administrador' : 'Balconista'
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
                <td class="px-4 py-2 text-gray-500 text-xs">${item.desc}</td>
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
        const dates = DB.getUniqueDates();
        ui.populateDateSelect('list-date-filter', dates, true);

        const search = document.getElementById('search-input').value.toLowerCase();
        const dateFilter = document.getElementById('list-date-filter').value;

        let data = DB.getInventory();

        if (dateFilter !== 'ALL') {
            data = data.filter(i => i.date === dateFilter);
        }

        data = data.filter(i => 
            i.code.toLowerCase().includes(search) || 
            i.desc.toLowerCase().includes(search) || 
            i.wh.toLowerCase().includes(search)
        );
        
        data.sort((a, b) => b.id - a.id);

        const tbody = document.getElementById('inventory-body');
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-gray-400">Nenhum item encontrado</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(item => `
            <tr class="hover:bg-gray-50 transition-colors border-b last:border-0">
                <td class="px-4 py-3 text-gray-500 text-xs">${item.date}</td>
                <td class="px-4 py-3">
                    <div class="text-xs font-bold text-gray-700">${item.registeredBy || 'Desconhecido'}</div>
                    <div class="text-[10px] text-gray-400 uppercase">${item.registeredRole || '-'}</div>
                </td>
                <td class="px-4 py-3 font-medium text-gray-900">${item.code}</td>
                <td class="px-4 py-3 text-gray-500 truncate max-w-xs text-xs" title="${item.desc}">${item.desc}</td>
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
        const dateFilter = document.getElementById('list-date-filter').value;
        let data = DB.getInventory();
        if (dateFilter !== 'ALL') {
            data = data.filter(i => i.date === dateFilter);
        }

        let csv = "Data;Responsavel;Cargo;Material;Descricao;Deposito;Qtd SAP;Contagem;Divergencia Qtd;Divergencia Valor\n";
        data.forEach(row => {
            csv += `${row.date};${row.registeredBy || ''};${row.registeredRole || ''};${row.code};${row.desc};${row.wh};${row.sapQ.toString().replace('.', ',')};${row.physQ.toString().replace('.', ',')};${row.divQ.toString().replace('.', ',')};${row.divVal.toFixed(2).replace('.', ',')}\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inventario_vertente_${dateFilter === 'ALL' ? 'geral' : dateFilter.replace(/\//g, '-')}.csv`;
        a.click();
    }
};

// --- DASHBOARD ---
const dashboard = {
    chartInstance: null,
    
    render: () => {
        const dates = DB.getUniqueDates();
        const select = document.getElementById('dashboard-date-filter');
        if (select.options.length <= 1 && dates.length > 0) {
            ui.populateDateSelect('dashboard-date-filter', dates, true);
        }

        const selectedDate = select.value;
        const allData = DB.getInventory();
        const data = selectedDate === 'ALL' ? allData : allData.filter(i => i.date === selectedDate);
        
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
        
        // Tenta carregar dados do Excel imediatamente ao iniciar o app
        MasterData.init();
        
        // Ativa os listeners para preenchimento em tempo real
        inventory.setupListeners();

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
