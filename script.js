// --- CONFIGURAÇÃO GITHUB (PREENCHA AQUI) ---
const GITHUB_CONFIG = {
    OWNER: 'MatheusFujimura1', 
    REPO: 'InventarioOficial',   
    TOKEN: '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', 
    FILE_PATH: 'database.json',
    BRANCH: 'main' 
};

// --- UTILS DE DADOS ---
const DataUtils = {
    // Remove espaços e converte para string para garantir que ' 123 ' bata com '123'
    normalizeCode: (code) => {
        if (code === undefined || code === null) return '';
        return String(code).replace(/\s+/g, '').trim().toUpperCase();
    },
    
    // Tenta limpar valores monetários do Excel (R$ 1.200,50 -> 1200.50)
    parseMoney: (val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            // Remove R$, espaços, pontos de milhar e troca vírgula por ponto
            const clean = val.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
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
            // alert('Erro ao carregar dados do GitHub. Verifique o console ou o Token.');
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

            if (!response.ok) {
                console.error(`Falha ao baixar ${filename}: ${response.status}`);
                return null;
            }

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
    descriptions: {}, // Mapa: Código Normalizado -> Descrição
    prices: {},       // Mapa: Código Normalizado -> Preço Unitário
    isLoaded: false,

    init: async () => {
        if (MasterData.isLoaded) return;
        
        const statusEl = document.getElementById('master-data-status');
        if(statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.innerHTML = `<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div><span class="text-gray-600">Baixando Valores.xlsx...</span>`;
        }

        // --- CARREGAR DADOS APENAS DE VALORES.XLSX ---
        // Coluna A (0) = Código
        // Coluna B (1) = Texto Breve (Descrição)
        // Coluna J (9) = Valor Unitário
        const valBuffer = await GithubDB.fetchBinaryFile('Valores.xlsx');
        if (valBuffer) {
            const wb = XLSX.read(valBuffer, {type: 'array'});
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, {header: 1});
            
            let count = 0;
            rows.forEach(row => {
                if (row[0] === undefined) return;
                const code = DataUtils.normalizeCode(row[0]);
                const desc = row[1]; // Coluna B
                const priceRaw = row[9]; // Coluna J (index 9)
                
                if (code) {
                    // 1. Salva Descrição
                    if (desc) {
                        MasterData.descriptions[code] = String(desc).trim();
                    }

                    // 2. Salva Preço
                    if (priceRaw !== undefined) {
                        const price = DataUtils.parseMoney(priceRaw);
                        if (!isNaN(price)) {
                            MasterData.prices[code] = price;
                        }
                    }
                    count++;
                }
            });
            console.log(`[Valores.xlsx] Processados ${count} itens (Descrições e Preços).`);
        } else {
            console.warn('[Valores.xlsx] Arquivo não encontrado ou erro no download.');
        }

        MasterData.isLoaded = true;
        if(statusEl) {
            statusEl.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-green-600"></i><span class="text-green-700 font-medium">Base Valores.xlsx sincronizada!</span>`;
            lucide.createIcons();
            
            // Tenta processar o que já estiver na tela
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
    // FUNÇÃO PRINCIPAL: PREENCHIMENTO AUTOMÁTICO
    triggerAutoFill: () => {
        if (!MasterData.isLoaded) return;
        
        const codeInput = document.getElementById('input-code');
        const sapInput = document.getElementById('input-sap');
        const descInput = document.getElementById('input-desc');
        const valInput = document.getElementById('input-val');

        if (!codeInput) return;

        const codes = codeInput.value.split('\n');
        const saps = sapInput.value.split('\n');
        
        // Arrays para os novos valores calculados
        const newDescs = [];
        const newVals = [];

        codes.forEach((codeRaw, i) => {
            const code = DataUtils.normalizeCode(codeRaw);
            
            // 1. DESCRIÇÃO
            // Busca descrição pelo código normalizado
            const desc = MasterData.descriptions[code];
            newDescs.push(desc || ''); // Se não achar, deixa vazio

            // 2. VALOR (Unitário * Quantidade)
            const qtyStr = saps[i] ? saps[i].replace(',', '.') : '0';
            let qty = parseFloat(qtyStr);
            if (isNaN(qty)) qty = 0;
            
            const unitPrice = MasterData.prices[code];
            
            if (unitPrice !== undefined && !isNaN(unitPrice)) {
                // Cálculo: Valor Unitário (do Excel) * Quantidade SAP (Digitada)
                const total = unitPrice * qty;
                newVals.push(total.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}));
            } else {
                newVals.push('');
            }
        });

        // Recria as strings com quebra de linha
        descInput.value = newDescs.join('\n');
        valInput.value = newVals.join('\n');
    },

    setupListeners: () => {
        // Ouve digitação no CÓDIGO e na QUANTIDADE SAP
        const codeInput = document.getElementById('input-code');
        const sapInput = document.getElementById('input-sap');

        const handleInput = () => {
            // Pequeno delay para não travar digitação rápida e dar tempo do paste processar
            requestAnimationFrame(() => {
                inventory.triggerAutoFill();
            });
        };

        if (codeInput) {
            codeInput.addEventListener('input', handleInput);
        }
        
        if (sapInput) {
            sapInput.addEventListener('input', handleInput);
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
            
            // 1. Descrição (Prioriza o que está na tela, que veio do autofill)
            let description = descs[i] ? descs[i].trim() : '';
            if (!description) description = MasterData.descriptions[code] || '';

            // 2. Quantidades
            const sapQ = DataUtils.parseMoney(saps[i] || '0');
            const physQ = DataUtils.parseMoney(physs[i] || '0');
            
            // 3. Valor Total SAP (Prioriza tela)
            let sapVal = 0;
            const rawVal = (vals[i] || '').trim();
            if (rawVal) {
                sapVal = DataUtils.parseMoney(rawVal);
            } else {
                // Fallback cálculo
                const unitPrice = MasterData.prices[code] || 0;
                sapVal = sapQ * unitPrice;
            }
            
            const unitVal = sapQ !== 0 ? sapVal / sapQ : 0;
            const divQ = physQ - sapQ;
            const divVal = divQ * unitVal;

            return {
                id: Date.now() + Math.random(),
                code: codeRaw.trim(), // Salva o código original visualmente
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
        a.download = `inventario_vertente_${dateFilter === 'ALL' ? 'geral' : dateFilter.replace(/\//g, '-')}.csv`;
        a.click();
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
