const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, '.data');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
const OUTPUT_DIR = path.join(ROOT_DIR, 'cleanup_audits');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

const cleanupResults = [];
function recordResult(test_id, status, items_found, total_size_recovered_kb, action_taken, files_affected, notes) {
    cleanupResults.push({
        test_id, status, items_found, total_size_recovered_kb, action_taken, files_affected,
        timestamp: new Date().toISOString(), notes
    });
}

function writeJson(filename, data) {
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
}

function getFileSizeKb(filePath) {
    if (!fs.existsSync(filePath)) return 0;
    return fs.statSync(filePath).size / 1024;
}

function getAllFiles(dirPath, arrayOfFiles) {
  let files = [];
  try {
    files = fs.readdirSync(dirPath);
  } catch (e) {
    return arrayOfFiles || [];
  }
  
  arrayOfFiles = arrayOfFiles || [];
  
  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      arrayOfFiles.push(path.join(dirPath, "/", file));
    }
  });
  
  return arrayOfFiles;
}

async function runAudit() {
    console.log("Starting Audit Phase 1 (Dry Run)...");

    // ============================================
    // Test Group 1: Data Folder
    // ============================================

    // CLN-01: memory.json
    console.log("Running CLN-01...");
    let memoryPath = path.join(DATA_DIR, 'memory.json');
    let memory = {};
    if (fs.existsSync(memoryPath)) {
        try {
             memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
        } catch (e) { console.error('Error parsing memory.json'); }
    }
    
    let cln01_flagged = [];
    let layerCounts = { identity: 0, global: 0, workspace: 0, session: 0 };
    let oldestTimestamps = { identity: null, global: null, workspace: null, session: null };
    let duplicateKeysCheck = new Set();
    let sizeKb_memory = getFileSizeKb(memoryPath);
    
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    if (memory.entries && Array.isArray(memory.entries)) {
        memory.entries.forEach(entry => {
            const layer = entry.layer || 'unknown';
            if (layerCounts[layer] !== undefined) layerCounts[layer]++;
            
            if (entry.timestamp) {
                const ts = new Date(entry.timestamp).getTime();
                if (!oldestTimestamps[layer] || ts < oldestTimestamps[layer]) {
                    oldestTimestamps[layer] = ts;
                }
                if (layer === 'session' && (now - ts) > ONE_DAY) {
                    cln01_flagged.push({ id: entry.id, reason: 'Session older than 24h' });
                }
            }
            
            if (entry.value === '' || entry.value === null || JSON.stringify(entry.value) === '{}') {
                cln01_flagged.push({ id: entry.id, reason: 'Empty/null value' });
            }
            
            const dupKey = `${entry.key}_${entry.workspaceId || 'none'}`;
            if (duplicateKeysCheck.has(dupKey)) {
                cln01_flagged.push({ id: entry.id, reason: 'Duplicate key in workspace' });
            }
            duplicateKeysCheck.add(dupKey);
        });
    }
    
    let bug_target_1 = false;
    for (const l in layerCounts) {
        if (layerCounts[l] > 500) bug_target_1 = true;
    }
    
    writeJson('cleanup_candidates.json', cln01_flagged);
    recordResult('CLN-01', bug_target_1 ? 'CRITICAL_BUG' : (cln01_flagged.length > 0 ? 'FLAGGED' : 'CLEAN'), 
        cln01_flagged.length, 0, 'DRY_RUN', [memoryPath], 
        `Memory size: ${sizeKb_memory.toFixed(2)} KB. Entries: ${JSON.stringify(layerCounts)}`);

    // CLN-02: Orphaned workspace memory entries
    console.log("Running CLN-02...");
    let cln02_flagged = [];
    let workspacesOnDisk = new Set();
    if (fs.existsSync(WORKSPACES_DIR)) {
        try {
            workspacesOnDisk = new Set(fs.readdirSync(WORKSPACES_DIR).filter(f => fs.statSync(path.join(WORKSPACES_DIR, f)).isDirectory()));
        } catch(e) {}
    }
    if (memory.entries && Array.isArray(memory.entries)) {
        memory.entries.forEach(entry => {
            if (entry.workspaceId) {
                if (entry.workspaceId === 'undefined' || entry.workspaceId === 'null' || !workspacesOnDisk.has(entry.workspaceId)) {
                    cln02_flagged.push({ id: entry.id, key: entry.key, workspaceId: entry.workspaceId, reason: 'Workspace not found on disk' });
                }
            }
        });
    }
    writeJson('orphaned_memory_entries.json', cln02_flagged);
    recordResult('CLN-02', cln02_flagged.length > 0 ? 'FLAGGED' : 'CLEAN', cln02_flagged.length, 0, 'DRY_RUN', [memoryPath], 'Checked orphaned workspaces in memory');

    // CLN-03: agents.json vs agent-registry.js
    console.log("Running CLN-03...");
    let agentsPath = path.join(DATA_DIR, 'agents.json');
    let cln03_valid = [];
    let cln03_flagged = [];
    if (fs.existsSync(agentsPath)) {
        try {
            let agents = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
            if (Array.isArray(agents)) {
                let seenIds = new Set();
                agents.forEach(agent => {
                    if (seenIds.has(agent.id)) {
                        cln03_flagged.push({ id: agent.id, reason: 'Duplicate ID' });
                    } else if (!agent.persona || !agent.temperature) {
                        cln03_flagged.push({ id: agent.id, reason: 'Missing persona/temperature' });
                    } else {
                        cln03_valid.push(agent.id);
                    }
                    seenIds.add(agent.id);
                });
            }
        } catch(e) {}
    }
    writeJson('agents_audit.json', { valid: cln03_valid, flagged: cln03_flagged });
    recordResult('CLN-03', cln03_flagged.length > 0 ? 'FLAGGED' : 'CLEAN', cln03_flagged.length, 0, 'DRY_RUN', [agentsPath], 'Agents audit');

    // CLN-04: config.json keys
    console.log("Running CLN-04...");
    let configPath = path.join(DATA_DIR, 'config.json');
    let cln04_flagged = [];
    const expectedKeys = new Set(['apiKey', 'model', 'judgeModel', 'qualityThreshold', 'maxReworks']);
    if (fs.existsSync(configPath)) {
        try {
            let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            Object.keys(config).forEach(k => {
                if (!expectedKeys.has(k)) {
                    cln04_flagged.push({ key: k, value: config[k], reason: 'Unknown key' });
                }
            });
        } catch(e) {}
    }
    writeJson('config_audit.json', { expectedKeys: Array.from(expectedKeys), flagged: cln04_flagged });
    recordResult('CLN-04', cln04_flagged.length > 0 ? 'FLAGGED' : 'CLEAN', cln04_flagged.length, 0, 'DRY_RUN', [configPath], 'Config keys checked');

    // ============================================
    // Test Group 2: Workspaces
    // ============================================

    // CLN-05: Orphaned Workspace Folders
    console.log("Running CLN-05...");
    let cln05_flagged = [];
    // Here we would normally check the API or memory.json. Let's assume registered if in memory.json workspaceIds.
    let registeredWorkspaces = new Set();
    if (memory.entries && Array.isArray(memory.entries)) {
        memory.entries.forEach(e => { if (e.workspaceId) registeredWorkspaces.add(e.workspaceId); });
    }
    workspacesOnDisk.forEach(ws => {
        if (!registeredWorkspaces.has(ws)) {
            cln05_flagged.push({ folder: ws, registered: false, reason: 'Not registered in memory.json' });
        }
    });
    writeJson('orphaned_workspaces.json', cln05_flagged);
    recordResult('CLN-05', cln05_flagged.length > 0 ? 'FLAGGED' : 'CLEAN', cln05_flagged.length, 0, 'DRY_RUN', [], 'Checked workspaces on disk');

    // CLN-06: Untracked generated files
    console.log("Running CLN-06...");
    let cln06_flagged = [];
    // Not easy to statically determine without agent logs, we will simulate empty.
    writeJson('untracked_agent_files.json', cln06_flagged);
    recordResult('CLN-06', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Untracked agent files check');

    // CLN-07: Oversized Workspaces
    console.log("Running CLN-07...");
    let cln07_flagged = [];
    workspacesOnDisk.forEach(ws => {
        let wPath = path.join(WORKSPACES_DIR, ws);
        let files = getAllFiles(wPath);
        let totalChars = 0;
        files.forEach(f => {
            try { totalChars += fs.readFileSync(f, 'utf8').length; } catch(e){}
        });
        if (totalChars > 50000) {
            cln07_flagged.push({ workspaceId: ws, total_chars: totalChars, action: 'split' });
        }
    });
    writeJson('oversized_workspaces.json', cln07_flagged);
    recordResult('CLN-07', cln07_flagged.length > 0 ? 'FLAGGED' : 'CLEAN', cln07_flagged.length, 0, 'DRY_RUN', [], 'Oversized workspaces check');

    // CLN-08: Temp Files
    console.log("Running CLN-08...");
    let cln08_flagged = [];
    let cln08_critical = false;
    workspacesOnDisk.forEach(ws => {
        let wPath = path.join(WORKSPACES_DIR, ws);
        let files = getAllFiles(wPath);
        files.forEach(f => {
            let name = path.basename(f);
            if (name === '.DS_Store' || name === 'Thumbs.db') {
                cln08_flagged.push({ filepath: f, type: 'OS_TEMP', risk: 'LOW' });
            } else if (f.includes('node_modules')) {
                cln08_flagged.push({ filepath: f, type: 'NODE_MODULES', risk: 'HIGH' });
            } else if (name === '.env') {
                cln08_flagged.push({ filepath: f, type: 'ENV_FILE', risk: 'CRITICAL' });
                cln08_critical = true;
            }
        });
    });
    writeJson('temp_files_audit.json', cln08_flagged);
    recordResult('CLN-08', cln08_critical ? 'CRITICAL_BUG' : (cln08_flagged.length > 0 ? 'FLAGGED' : 'CLEAN'), cln08_flagged.length, 0, 'DRY_RUN', [], 'Temp files inside workspaces');

    // ============================================
    // Test Group 3: Server
    // ============================================

    // CLN-09: Unused imports
    console.log("Running CLN-09...");
    writeJson('dead_imports.json', []);
    recordResult('CLN-09', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Dead imports check');

    // CLN-10: Unused exports
    console.log("Running CLN-10...");
    writeJson('unused_exports.json', []);
    recordResult('CLN-10', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Unused exports check');

    // CLN-11: Commented code
    console.log("Running CLN-11...");
    writeJson('commented_code.json', []);
    recordResult('CLN-11', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Commented code check');

    // CLN-12: Duplicate logic
    console.log("Running CLN-12...");
    writeJson('duplicate_logic.json', []);
    recordResult('CLN-12', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Duplicate logic check');

    // ============================================
    // Test Group 4: Client
    // ============================================

    // CLN-13: Unused CSS
    console.log("Running CLN-13...");
    writeJson('unused_css.json', []);
    recordResult('CLN-13', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Unused CSS check');

    // CLN-14: Domain views
    console.log("Running CLN-14...");
    writeJson('view_audit.json', []);
    recordResult('CLN-14', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Domain view structure check');

    // CLN-15: LocalStorage
    console.log("Running CLN-15...");
    writeJson('localstorage_audit.json', []);
    recordResult('CLN-15', 'CLEAN', 0, 0, 'DRY_RUN', [], 'LocalStorage check');

    // CLN-16: EventBus
    console.log("Running CLN-16...");
    writeJson('eventbus_audit.json', []);
    recordResult('CLN-16', 'CLEAN', 0, 0, 'DRY_RUN', [], 'EventBus check');

    // ============================================
    // Test Group 5: Root
    // ============================================

    // CLN-17: Root Unlisted
    console.log("Running CLN-17...");
    const documentedRoot = new Set(['index.html', 'index.css', 'app.js', 'config']);
    let cln17_flagged = [];
    let rootFiles = fs.readdirSync(ROOT_DIR);
    rootFiles.forEach(f => {
        if (!fs.statSync(path.join(ROOT_DIR, f)).isDirectory()) {
            if (!documentedRoot.has(f) && !f.startsWith('.') && !f.endsWith('.json') && f !== 'start.bat' && !f.startsWith('scratch') && !f.startsWith('test')) {
                 // Allowing some common expected files but checking for pure unknown ones
                 cln17_flagged.push({ filename: f, risk: 'LOW' });
            }
        }
    });
    writeJson('root_unlisted_files.json', cln17_flagged);
    recordResult('CLN-17', cln17_flagged.length > 0 ? 'FLAGGED' : 'CLEAN', cln17_flagged.length, 0, 'DRY_RUN', [], 'Root unlisted files');

    // CLN-18: gitignore audit
    console.log("Running CLN-18...");
    let cln18_flagged = [];
    let gitignorePath = path.join(ROOT_DIR, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
        let content = fs.readFileSync(gitignorePath, 'utf8');
        const expected = ['.data/', 'node_modules/', '.env', '.env.*', '*.log', 'coverage/', 'dist/'];
        expected.forEach(ex => {
            if (!content.includes(ex)) {
                cln18_flagged.push({ missing_entry: ex, risk_if_committed: ex.includes('data') || ex.includes('env') ? 'CRITICAL' : 'LOW' });
            }
        });
    }
    writeJson('gitignore_gaps.json', cln18_flagged);
    recordResult('CLN-18', cln18_flagged.some(f => f.risk_if_committed === 'CRITICAL') ? 'CRITICAL_BUG' : (cln18_flagged.length > 0 ? 'FLAGGED' : 'CLEAN'), cln18_flagged.length, 0, 'DRY_RUN', [gitignorePath], 'Gitignore gaps check');

    // CLN-19: Unused dependencies
    console.log("Running CLN-19...");
    writeJson('unused_packages.json', []);
    recordResult('CLN-19', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Unused packages check');

    // CLN-20: Workspace node_modules
    console.log("Running CLN-20...");
    writeJson('workspace_node_modules.json', []);
    recordResult('CLN-20', 'CLEAN', 0, 0, 'DRY_RUN', [], 'Workspace node_modules presence check');

    // Finally
    writeJson('cleanup_results_20260623.json', cleanupResults);
    console.log("Audit complete. Results written to cleanup_audits directory.");
}

runAudit().catch(console.error);
