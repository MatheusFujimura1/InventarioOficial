// --- CONFIGURAÇÃO GITHUB ---
const GITHUB_CONFIG = {
    OWNER: 'MatheusFujimura1', 
    REPO: 'InventarioOficial',   
    TOKEN: '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', 
    FILE_PATH: 'database.json',
    BRANCH: 'main' 
};

// --- UTILS DE DADOS ---
const DataUtils = {
    // Normaliza o código: remove espaços, converte para string e maiúsculo
    normalizeCode: (code) => {
        if (code === undefined || code === null) return '';
        return String(code).replace(/\s+/g, '').trim().toUpperCase();
    },
    
    // Tenta limpar valores monetários
    parseMoney: (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            if (!val.trim()) return 0;
            let clean = val.replace(/[R$\s]/g, '');
            // Lógica para detectar formato brasileiro (1.000,00) vs americano (1,000.00)
            if (clean.includes(',') && clean.includes('.')) {
                clean = clean.replace(/\./g, '').replace(',', '.');
            } else if (clean.includes(',')) {
                clean = clean.replace(',', '.');
            }
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

    // Ler dados JSON do GitHub (Database do App)
    fetchData: async () => {
        try {
            // Adiciona timestamp para evitar cache
            const url = `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${GITHUB_CONFIG.FILE_PATH}?ref=${GITHUB_CONFIG.BRANCH}&ts=${new Date().getTime()}`;
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
            return null;
        }
    },

    // Buscar arquivo binário (Excel) do GitHub - MODO RAW (CORRIGIDO)
    fetchBinaryFile: async (filename) => {
        try {
            const url = `https://api.github.com/repos/${GITHUB_CONFIG.OWNER}/${GITHUB_CONFIG.REPO}/contents/${filename}?ref=${GITHUB_CONFIG.BRANCH}&ts=${new Date().getTime()}`;
            
            // Usando header para pegar conteúdo RAW (bytes direto) ao invés de JSON Base64
            // Isso resolve problemas com arquivos maiores que 1MB
            console.log(`Baixando: ${url}`);
            const response = await fetch(url, {
                headers: {
                    'Authorization': `token ${GITHUB_CONFIG.TOKEN}`,
                    'Accept': 'application/vnd.github.v3.raw' 
                }
            });

            if (!response.ok) {
                console.warn(`GitHub Raw Error: ${response.status}`);
                return null;
            }

            // Pega o buffer direto (transforma a resposta da internet em "arquivo")
            const buffer = await response.arrayBuffer();
            return new Uint8Array(buffer);

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

            if (!response.ok) throw new Error('Falha ao salvar');

            const json = await response.json();
            GithubDB.sha = json.content.sha;
            GithubDB.data = newData;
            return true;
        } catch (error) {
            alert('Erro ao salvar no GitHub: ' + error.message);
            return false;
        } finally {
            ui.showLoading(false);
        }
    }
};

// --- DADOS MESTRES (EXCEL - VALORES.XLSX) ---
const MasterData = {
    descriptions: {}, 
    prices: {},       
    isLoaded: false,

    init: async () => {
        const statusEl = document.getElementById('master-data-status');
        if(statusEl) statusEl.innerHTML = `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div><span class="text-gray-600">Baixando Valores.xlsx...</span>`;

        // Tenta baixar o arquivo "transformado em bytes"
        const valBuffer = await GithubDB.fetchBinaryFile('Valores.xlsx');
        
        if (valBuffer) {
            const wb = XLSX.read(valBuffer, {type: 'array'});
            // Chama EXATAMENTE a mesma função que o upload local usa
            MasterData.processWorkbook(wb, 'GitHub');
        } else {
            if(statusEl) statusEl.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-red-600"></i><span class="text-red-700 font-medium">Erro no GitHub. Use "Carregar do PC".</span>`;
            lucide.createIcons();
        }
    },

    handleUpload: (input) => {
        const file = input.files[0];
        if(!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const data = new Uint8Array(e.target.result);
            const wb = XLSX.read(data, {type: 'array'});
            // Chama EXATAMENTE a mesma função que o GitHub usa
            MasterData.processWorkbook(wb, 'Local (PC)');
        };
        reader.readAsArrayBuffer(file);
    },

    // Esta função processa os dados, não importa de onde vieram
    processWorkbook: (wb, sourceName) => {
        const statusEl = document.getElementById('master-data-status');
        
        // Pega a primeira aba
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        
        // Converte para array de arrays
        const rows = XLSX.utils.sheet_to_json(ws, {header: 1});
        
        // --- LÓGICA DE DETECÇÃO DO CABEÇALHO ---
        // Procura a linha que contém "Material" ou "Texto breve"
        let headerIndex = -1;
        for (let i = 0; i < Math.min(rows.length, 20); i++) {
            const rowStr = JSON.stringify(rows[i]).toLowerCase();
            if (rowStr.includes("material") || rowStr.includes("texto breve")) {
                headerIndex = i;
                break;
            }
        }

        // Se não achou, assume 0
        const startIndex = headerIndex === -1 ? 0 : headerIndex + 1;
        const dataRows = rows.slice(startIndex);
        
        let count = 0;
        MasterData.descriptions = {};
        MasterData.prices = {};

        dataRows.forEach(row => {
            // Índices baseados na solicitação: 
            // A (0) = Material
            // B (1) = Texto Breve
            // J (9) = Valor Unitário
            
            const rawCode = row[0];
            if (rawCode === undefined || rawCode === null) return;
            
            const code = DataUtils.normalizeCode(rawCode);
            if (!code) return;

            const desc = row[1];
            const priceRaw = row[9]; // Coluna J é índice 9

            // Salva descrição
            if (desc) MasterData.descriptions[code] = String(desc).trim();

            // Salva preço
            if (priceRaw !== undefined) {
                const price = DataUtils.parseMoney(priceRaw);
                if (!isNaN(price)) MasterData.prices[code] = price;
            }
            count++;
        });
        
        console.log(`[Valores.xlsx] Carregado de ${sourceName}. ${count} itens processados.`);
        
        MasterData.isLoaded = true;
        if(statusEl) {
            statusEl.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-green-600"></i><span class="text-green-700 font-medium">Base Tereos (${sourceName}) OK! (${count} itens)</span>`;
            lucide.createIcons();
        }
        
        // Dispara o autopreenchimento se houver algo na tela
        inventory.triggerAutoFill();
    }
};

// --- DASHBOARD ---
const dashboard = {
    chartInstance: null,

    render: () => {
        const data = DB.getInventory();
        const dateFilter = document.getElementById('dashboard-date-filter').value;
        
        // Filtragem de dados
        let filteredData = data;
        if (dateFilter !== 'ALL') {
            filteredData = data.filter(d => d.date === dateFilter);
        }

        // --- CÁLCULOS KPI ---
        const totalItems = filteredData.length;
        const divergentItems = filteredData.filter(i => i.divQ !== 0);
        const accuracy = totalItems > 0 ? ((totalItems - divergentItems.length) / totalItems) * 100 : 0;
        const totalDivergenceVal = filteredData.reduce((acc, curr) => acc + curr.divVal, 0);
        const totalSapVal = filteredData.reduce((acc, curr) => acc + curr.sapVal, 0);

        // --- ATUALIZAR KPIs ---
        document.getElementById('kpi-total').innerText = totalItems;
        document.getElementById('kpi-accuracy').innerText = `${accuracy.toFixed(1)}%`;
        
        const divEl = document.getElementById('kpi-divergence');
        divEl.innerText = totalDivergenceVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
        divEl.className = `text-2xl font-bold mt-1 ${totalDivergenceVal === 0 ? 'text-gray-800' : (totalDivergenceVal > 0 ? 'text-blue-600' : 'text-red-600')}`;

        document.getElementById('kpi-sap-value').innerText = totalSapVal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});

        // --- GRÁFICO (Chart.js) ---
        dashboard.renderChart(filteredData);
        
        // --- RANKING DE USUÁRIOS ---
        dashboard.renderRanking(filteredData);
    },

    renderRanking: (data) => {
        const rankContainer = document.getElementById('users-ranking-list');
        if (!rankContainer) return;

        // Contar registros por usuário
        const counts = {};
        data.forEach(item => {
            const user = item.registeredBy || 'Desconhecido';
            counts[user] = (counts[user] || 0) + 1;
        });

        // Converter para array e ordenar
        const sorted = Object.entries(counts)
            .sort((a, b) => b[1] - a[1]) // Maior para menor
            .slice(0, 5); // Top 5

        if (sorted.length === 0) {
            rankContainer.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">Sem dados</p>';
            return;
        }

        rankContainer.innerHTML = sorted.map((item, index) => {
            const name = item[0];
            const count = item[1];
            // Estilos para o Top 3
            let badgeClass = "bg-gray-100 text-gray-600";
            let icon = "";
            if (index === 0) { badgeClass = "bg-yellow-100 text-yellow-700"; icon = "👑"; }
            else if (index === 1) { badgeClass = "bg-slate-200 text-slate-700"; icon = "🥈"; }
            else if (index === 2) { badgeClass = "bg-orange-100 text-orange-700"; icon = "🥉"; }

            return `
                <div class="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors border-b last:border-0 border-gray-50">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${badgeClass}">
                           ${icon || (index + 1)}
                        </div>
                        <span class="font-medium text-gray-700 text-sm">${name}</span>
                    </div>
                    <span class="font-bold text-gray-900 bg-white border border-gray-200 px-2 py-1 rounded text-xs">
                        ${count} itens
                    </span>
                </div>
            `;
        }).join('');
    },

    renderChart: (data) => {
        const ctx = document.getElementById('chart-divergence');
        if (!ctx) return;

        // Agrupar divergência por Depósito
        const warehouseGroups = {};
        data.forEach(item => {
            if (!warehouseGroups[item.wh]) warehouseGroups[item.wh] = 0;
            warehouseGroups[item.wh] += item.divVal; 
        });

        const labels = Object.keys(warehouseGroups);
        const values = Object.values(warehouseGroups);
        const backgroundColors = values.map(v => v < 0 ? '#ef4444' : '#3b82f6'); 

        if (dashboard.chartInstance) {
            dashboard.chartInstance.destroy();
        }

        dashboard.chartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Divergência Financeira (R$)',
                    data: values,
                    backgroundColor: backgroundColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return 'R$ ' + value;
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
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
        if (view === 'import' && !MasterData.isLoaded) MasterData.init();
    }
};

// --- LÓGICA DE INVENTÁRIO ---
let previewData = [];

const inventory = {
    triggerAutoFill: () => {
        const codeInput = document.getElementById('input-code');
        const sapInput = document.getElementById('input-sap'); 
        const descInput = document.getElementById('input-desc'); 
        const valInput = document.getElementById('input-val'); 

        if (!codeInput) return;

        const codeLines = codeInput.value.split('\n');
        const sapLines = sapInput.value.split('\n');
        const currentDescLines = descInput.value.split('\n');
        const currentValLines = valInput.value.split('\n');
        
        const newDescs = [];
        const newVals = [];

        codeLines.forEach((codeRaw, i) => {
            const code = DataUtils.normalizeCode(codeRaw);
            
            const dbDesc = MasterData.descriptions[code];
            const dbUnitPrice = MasterData.prices[code];

            const sapQStr = sapLines[i] ? String(sapLines[i]) : '0';
            const sapQ = DataUtils.parseMoney(sapQStr);

            // 1. DESCRIÇÃO: Prioriza DB, senão mantém manual
            if (dbDesc) {
                newDescs.push(dbDesc);
            } else {
                newDescs.push(currentDescLines[i] || '');
            }

            // 2. VALOR TOTAL: Se tem preço unitário, calcula. Senão mantém manual.
            if (dbUnitPrice !== undefined && !isNaN(dbUnitPrice)) {
                const total = dbUnitPrice * sapQ;
                newVals.push(total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}));
            } else {
                newVals.push(currentValLines[i] || '');
            }
        });

        descInput.value = newDescs.join('\n');
        valInput.value = newVals.join('\n');
    },

    setupListeners: () => {
        const codeInput = document.getElementById('input-code');
        const sapInput = document.getElementById('input-sap');

        const handleInput = () => {
            requestAnimationFrame(() => {
                inventory.triggerAutoFill();
            });
        };

        if (codeInput) {
            codeInput.addEventListener('input', handleInput);
            codeInput.addEventListener('blur', handleInput);
            // Detecta 'paste' especificamente para garantir que processou
            codeInput.addEventListener('paste', () => setTimeout(handleInput, 100));
        }
        
        if (sapInput) {
            sapInput.addEventListener('input', handleInput);
            sapInput.addEventListener('blur', handleInput);
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
            const code = DataUtils.normalizeCode(codeRaw);
            if (!code) return null;
            
            // Usa o que está na tela (Automático ou Manual)
            const description = descs[i] ? descs[i].trim() : '';
            
            const sapQ = DataUtils.parseMoney(saps[i] || '0');
            const physQ = DataUtils.parseMoney(physs[i] || '0');
            
            let sapVal = 0;
            const rawVal = (vals[i] || '').trim();
            sapVal = DataUtils.parseMoney(rawVal);
            
            // Fallback: se valor for 0 mas tivermos preço no banco
            if (sapVal === 0 && MasterData.prices[code]) {
                sapVal = sapQ * MasterData.prices[code];
            }
            
            // Valor Unitário Implícito (para cálculo da divergência)
            let unitVal = 0;
            if (sapQ !== 0) {
                unitVal = sapVal / sapQ;
            } else if (MasterData.prices[code]) {
                unitVal = MasterData.prices[code];
            }
            
            const divQ = physQ - sapQ;
            const divVal = divQ * unitVal;

            return {
                id: Date.now() + Math.random(),
                code: codeRaw.trim(),
                desc: description,
                wh: whs[i] || 'GERAL',
                sapQ,
                physQ,
                sapVal,
                divQ,
                divVal,
                date: new Date().toLocaleDateString('pt-BR'),
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
        a.download = `inventario_tereos_${dateFilter === 'ALL' ? 'geral' : dateFilter.replace(/\//g, '-')}.csv`;
        a.click();
    }
};

// --- USERS UI (Simples) ---
const users = {
    render: () => {
        const list = DB.getUsers();
        const tbody = document.getElementById('users-body');
        tbody.innerHTML = list.map(u => `
            <tr>
                <td class="px-4 py-2">${u.name}</td>
                <td class="px-4 py-2 text-gray-500">${u.username}</td>
                <td class="px-4 py-2"><span class="px-2 py-1 bg-gray-100 rounded text-xs">${u.role}</span></td>
                <td class="px-4 py-2 text-right">
                    ${u.username !== 'mvfujimura' ? `<button onclick="users.remove('${u.id}')" class="text-red-500 hover:text-red-700"><i data-lucide="trash"></i></button>` : ''}
                </td>
            </tr>
        `).join('');
        lucide.createIcons();
    },
    add: async (e) => {
        e.preventDefault();
        const name = document.getElementById('new-user-name').value;
        const user = document.getElementById('new-user-login').value;
        const pass = document.getElementById('new-user-pass').value;
        const role = document.getElementById('new-user-role').value;

        const current = DB.getUsers();
        if(current.find(u => u.username === user)) return alert('Login já existe');

        const newUser = { id: Date.now().toString(), name, username: user, password: pass, role };
        const success = await DB.update('users', [...current, newUser]);
        if(success) {
            users.render();
            e.target.reset();
        }
    },
    remove: async (id) => {
        if(confirm('Remover usuário?')) {
            const current = DB.getUsers();
            const success = await DB.update('users', current.filter(u => u.id !== id));
            if(success) users.render();
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
        
        // Carrega datas de filtro
        const dates = DB.getUniqueDates();
        ui.populateDateSelect('dashboard-date-filter', dates, true);

        // Listeners e MasterData
        MasterData.init();
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
