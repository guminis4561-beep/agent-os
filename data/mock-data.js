// ═══════════════════════════════════════════════════
// MOCK DATA – Realistic sample data for all domains
// ═══════════════════════════════════════════════════

export const WORKSPACES = [
  {
    id: 'ws-1',
    name: 'Production AI Ops',
    description: 'Main production workspace for AI operations and monitoring',
    icon: '🚀',
    agents: 12,
    workflows: 8,
    memoryUsage: 67,
    createdAt: '2026-05-15',
    isActive: true,
  },
  {
    id: 'ws-2',
    name: 'Trading Research',
    description: 'Quantitative trading strategy research and backtesting',
    icon: '📊',
    agents: 5,
    workflows: 3,
    memoryUsage: 42,
    createdAt: '2026-06-01',
    isActive: false,
  },
  {
    id: 'ws-3',
    name: 'Content Pipeline',
    description: 'Automated content creation and distribution pipeline',
    icon: '🎨',
    agents: 8,
    workflows: 6,
    memoryUsage: 55,
    createdAt: '2026-06-10',
    isActive: false,
  },
];

export const AGENTS = [
  {
    id: 'agent-1',
    name: 'CodeWeaver',
    type: 'coding',
    status: 'active',
    description: 'Full-stack code generation and refactoring agent with deep understanding of modern frameworks.',
    capabilities: ['Code Generation', 'Refactoring', 'Testing', 'Review'],
    allowedTools: ['AST Parser', 'Git Client', 'Terminal', 'Linter'],
    memoryScopes: {
      identity: 'read', global: 'read', workspace: 'write', session: 'write'
    },
    auditTrail: [
      { action: 'Created PR #127', time: '2 min ago', status: 'success' },
      { action: 'Refactored auth.service.ts', time: '1 hour ago', status: 'success' }
    ],
    model: 'GPT-4 Turbo',
    runsToday: 47,
    successRate: 96.2,
    avgLatency: '2.3s',
    icon: '💻',
    color: 'var(--coding-accent)',
  },
  {
    id: 'agent-2',
    name: 'MarketSense',
    type: 'trading',
    status: 'active',
    description: 'Real-time market analysis agent that monitors multiple exchanges and generates trading signals.',
    capabilities: ['Signal Detection', 'Risk Analysis', 'Portfolio Optimization'],
    allowedTools: ['Binance API', 'TradingView Scraper', 'Risk Engine'],
    memoryScopes: {
      identity: 'read', global: 'write', workspace: 'read', session: 'write'
    },
    auditTrail: [
      { action: 'Detected BUY signal ETH/USD', time: '5 min ago', status: 'success' },
      { action: 'Updated Global Market Model', time: '30 min ago', status: 'success' }
    ],
    model: 'Claude 3.5',
    runsToday: 156,
    successRate: 89.7,
    avgLatency: '1.1s',
    icon: '📈',
    color: 'var(--trading-accent)',
  },
  {
    id: 'agent-3',
    name: 'PixelForge',
    type: 'creation',
    status: 'idle',
    description: 'Creative content generation agent capable of producing images, copy, and design assets.',
    capabilities: ['Image Gen', 'Copywriting', 'Design', 'Video'],
    allowedTools: ['Figma API', 'Midjourney Connector', 'Storage DB'],
    memoryScopes: {
      identity: 'read', global: 'read', workspace: 'write', session: 'write'
    },
    auditTrail: [
      { action: 'Generated 3 banner variants', time: '25 min ago', status: 'success' },
      { action: 'Failed to access Figma API', time: '2 hours ago', status: 'error' }
    ],
    model: 'Gemini Ultra',
    runsToday: 23,
    successRate: 94.1,
    avgLatency: '4.7s',
    icon: '🎨',
    color: 'var(--creation-accent)',
  },
  {
    id: 'agent-4',
    name: 'DataMiner',
    type: 'coding',
    status: 'active',
    description: 'Data extraction and transformation agent for ETL pipelines and structured data processing.',
    capabilities: ['Web Scraping', 'Data Cleaning', 'ETL', 'Analysis'],
    allowedTools: ['Puppeteer', 'PostgreSQL Client', 'Regex Engine'],
    memoryScopes: {
      identity: 'read', global: 'read', workspace: 'write', session: 'write'
    },
    auditTrail: [
      { action: 'Extracted 12k rows from source', time: '18 min ago', status: 'success' }
    ],
    model: 'GPT-4 Turbo',
    runsToday: 89,
    successRate: 97.8,
    avgLatency: '3.2s',
    icon: '⛏️',
    color: 'var(--coding-accent)',
  },
  {
    id: 'agent-5',
    name: 'SentinelWatch',
    type: 'trading',
    status: 'paused',
    description: 'Risk monitoring agent that tracks portfolio exposure and sends alerts on threshold breaches.',
    capabilities: ['Risk Monitoring', 'Alert System', 'Compliance Check'],
    allowedTools: ['Portfolio API', 'Slack Notifier', 'Compliance DB'],
    memoryScopes: {
      identity: 'read', global: 'read', workspace: 'read', session: 'write'
    },
    auditTrail: [
      { action: 'Sent risk alert (75% threshold)', time: '12 min ago', status: 'warning' }
    ],
    model: 'Claude 3.5',
    runsToday: 34,
    successRate: 99.1,
    avgLatency: '0.8s',
    icon: '🛡️',
    color: 'var(--trading-accent)',
  },
  {
    id: 'agent-6',
    name: 'StoryTeller',
    type: 'creation',
    status: 'active',
    description: 'Long-form content creation agent specializing in blog posts, documentation, and narratives.',
    capabilities: ['Blog Writing', 'Documentation', 'SEO', 'Editing'],
    allowedTools: ['Wordpress API', 'SEO Analyzer', 'Grammar Checker'],
    memoryScopes: {
      identity: 'read', global: 'read', workspace: 'write', session: 'write'
    },
    auditTrail: [
      { action: 'Published blog post', time: '2 hours ago', status: 'success' }
    ],
    model: 'Gemini Ultra',
    runsToday: 15,
    successRate: 92.5,
    avgLatency: '6.1s',
    icon: '✍️',
    color: 'var(--creation-accent)',
  },
  {
    id: 'agent-7',
    name: 'DebugHound',
    type: 'coding',
    status: 'active',
    description: 'Automated debugging agent that traces errors, analyzes logs, and suggests fixes.',
    capabilities: ['Error Tracing', 'Log Analysis', 'Fix Suggestion', 'Performance'],
    allowedTools: ['Logstash API', 'AST Parser', 'Terminal'],
    memoryScopes: {
      identity: 'read', global: 'read', workspace: 'write', session: 'write'
    },
    auditTrail: [
      { action: 'Analyzed auth.service.ts errors', time: '1 hour ago', status: 'warning' }
    ],
    model: 'GPT-4 Turbo',
    runsToday: 62,
    successRate: 88.4,
    avgLatency: '2.9s',
    icon: '🐛',
    color: 'var(--coding-accent)',
  },
  {
    id: 'agent-8',
    name: 'Orchestrator Prime',
    type: 'coding',
    status: 'active',
    description: 'Meta-agent that coordinates and schedules other agents within complex workflows.',
    capabilities: ['Scheduling', 'Coordination', 'Load Balancing', 'Monitoring'],
    allowedTools: ['Workflow Engine', 'Docker API', 'Event Bus'],
    memoryScopes: {
      identity: 'read', global: 'write', workspace: 'write', session: 'write'
    },
    auditTrail: [
      { action: 'Scheduled nightly report', time: '10 min ago', status: 'success' },
      { action: 'Scaled CodeWeaver instances', time: '4 hours ago', status: 'success' }
    ],
    model: 'Claude 3.5',
    runsToday: 203,
    successRate: 99.5,
    avgLatency: '0.5s',
    icon: '🎯',
    color: 'var(--accent-primary)',
  },
];

export const WORKFLOWS = [
  {
    id: 'wf-1',
    name: 'Master Pipeline',
    description: 'Core analysis to execution pipeline',
    status: 'running',
    agents: ['CodeWeaver', 'DebugHound', 'MarketSense'],
    runs: 512,
    lastRun: '1 min ago',
    successRate: 98.2,
    icon: '⚡',
    nodes: [
      { id: 'n1', type: 'trigger', name: 'Input', x: 50, y: 200, status: 'success', owner: 'System', tools: ['Webhook'], schemaIn: 'None', schemaOut: 'RawData' },
      { id: 'n2', type: 'agent', name: 'Analyze', x: 300, y: 200, status: 'success', owner: 'CodeWeaver', tools: ['AST Parser'], schemaIn: 'RawData', schemaOut: 'Metrics' },
      { id: 'n3', type: 'condition', name: 'Decide', x: 550, y: 200, status: 'success', owner: 'System', tools: ['RulesEngine'], schemaIn: 'Metrics', schemaOut: 'Decision' },
      { id: 'n4', type: 'action', name: 'Execute', x: 800, y: 200, status: 'running', owner: 'MarketSense', tools: ['API Client'], schemaIn: 'Decision', schemaOut: 'Result' },
      { id: 'n5', type: 'agent', name: 'Validate', x: 1050, y: 200, status: 'idle', owner: 'DebugHound', tools: ['Validator'], schemaIn: 'Result', schemaOut: 'Validation' },
      { id: 'n6', type: 'output', name: 'Save to Memory', x: 1300, y: 200, status: 'idle', owner: 'System', tools: ['DB', 'L1 Cache'], schemaIn: 'Validation', schemaOut: 'StoredItem' },
    ],
    connections: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
      { from: 'n3', to: 'n4' },
      { from: 'n4', to: 'n5' },
      { from: 'n5', to: 'n6' },
    ],
  },
  {
    id: 'wf-2',
    name: 'Market Signal → Trade',
    description: 'End-to-end trading signal detection to order execution',
    status: 'running',
    agents: ['MarketSense', 'SentinelWatch'],
    runs: 1289,
    lastRun: '30 sec ago',
    successRate: 91.2,
    icon: '⚡',
  },
  {
    id: 'wf-3',
    name: 'Content Generation',
    description: 'AI-powered content creation from brief to published article',
    status: 'idle',
    agents: ['PixelForge', 'StoryTeller'],
    runs: 67,
    lastRun: '1 hour ago',
    successRate: 93.8,
    icon: '📝',
  },
  {
    id: 'wf-4',
    name: 'Data ETL Pipeline',
    description: 'Extract, transform, and load data from multiple sources',
    status: 'running',
    agents: ['DataMiner'],
    runs: 456,
    lastRun: '5 min ago',
    successRate: 98.2,
    icon: '🔄',
  },
  {
    id: 'wf-5',
    name: 'Nightly Report',
    description: 'Generate comprehensive daily performance reports',
    status: 'scheduled',
    agents: ['DataMiner', 'StoryTeller'],
    runs: 89,
    lastRun: '12 hours ago',
    successRate: 97.1,
    icon: '📋',
  },
];

export const MEMORY_LAYERS = {
  L1: {
    name: 'Working Memory',
    description: 'Current session context — volatile, fast access',
    level: 'L1',
    entries: 24,
    size: '2.1 MB',
    icon: '⚡',
    items: [
      { key: 'current_workflow', value: 'Code Review Pipeline (wf-1)', type: 'ref', timestamp: 'now' },
      { key: 'active_agents', value: '[CodeWeaver, DebugHound, MarketSense]', type: 'array', timestamp: 'now' },
      { key: 'user_context', value: '{ role: "admin", workspace: "Production AI Ops" }', type: 'object', timestamp: 'now' },
      { key: 'session_tokens', value: '12,847 used / 128,000 limit', type: 'metric', timestamp: 'now' },
      { key: 'pending_tasks', value: '3 tasks in queue', type: 'counter', timestamp: '2 sec ago' },
    ],
  },
  L2: {
    name: 'Short-term Memory',
    description: 'Recent sessions and interactions — last 48 hours',
    level: 'L2',
    entries: 156,
    size: '18.4 MB',
    icon: '🕐',
    items: [
      { key: 'conversation_2026-06-19', value: 'Code review discussion with 12 messages', type: 'log', timestamp: '1 hour ago' },
      { key: 'workflow_run_wf-1_#234', value: 'Success: 2 issues found, 1 auto-fixed', type: 'result', timestamp: '2 hours ago' },
      { key: 'agent_perf_snapshot', value: 'All 8 agents healthy, avg latency 2.7s', type: 'metric', timestamp: '3 hours ago' },
      { key: 'user_preferences_cache', value: '{ theme: "dark", layout: "full" }', type: 'config', timestamp: '6 hours ago' },
      { key: 'error_log_batch', value: '3 recoverable errors in last 24h', type: 'log', timestamp: '12 hours ago' },
    ],
  },
  L3: {
    name: 'Long-term Memory',
    description: 'Persistent knowledge — learned patterns and facts',
    level: 'L3',
    entries: 2847,
    size: '142 MB',
    icon: '🧠',
    items: [
      { key: 'coding_patterns', value: '847 learned code patterns across 12 languages', type: 'knowledge', timestamp: '3 days ago' },
      { key: 'trading_strategies', value: '23 validated strategies with backtest data', type: 'knowledge', timestamp: '1 week ago' },
      { key: 'user_behavior_model', value: 'Preference graph with 156 data points', type: 'model', timestamp: '2 days ago' },
      { key: 'agent_reliability_scores', value: 'Historical success rates for all 8 agents', type: 'metric', timestamp: '1 day ago' },
      { key: 'workflow_templates', value: '15 proven workflow templates', type: 'template', timestamp: '5 days ago' },
    ],
  },
  L4: {
    name: 'Archival Memory',
    description: 'Historical data — compressed, long-term storage',
    level: 'L4',
    entries: 15632,
    size: '1.2 GB',
    icon: '🗄️',
    items: [
      { key: 'run_history_2026_Q1', value: '4,521 workflow runs archived', type: 'archive', timestamp: '3 months ago' },
      { key: 'agent_evolution_log', value: 'Configuration changes since inception', type: 'log', timestamp: '6 months ago' },
      { key: 'performance_baselines', value: 'Monthly performance snapshots', type: 'metric', timestamp: '1 month ago' },
      { key: 'deprecated_workflows', value: '12 retired workflow configurations', type: 'archive', timestamp: '2 months ago' },
      { key: 'training_data_index', value: 'Index of 8.2GB training datasets', type: 'index', timestamp: '4 months ago' },
    ],
  },
};

export const DASHBOARD_STATS = {
  activeAgents: { value: 6, total: 8, trend: '+2', trendDir: 'up' },
  workflows: { value: 8, running: 3, trend: '+12%', trendDir: 'up' },
  memoryUsage: { value: '1.36', unit: 'GB', trend: '-5%', trendDir: 'down' },
  totalRuns: { value: '2,135', trend: '+18%', trendDir: 'up' },
};

export const ACTIVITY_FEED = [
  { id: 1, type: 'success', message: 'CodeWeaver completed code review for PR #127', time: '2 min ago', agent: 'CodeWeaver' },
  { id: 2, type: 'info', message: 'MarketSense detected BUY signal for ETH/USD', time: '5 min ago', agent: 'MarketSense' },
  { id: 3, type: 'warning', message: 'SentinelWatch: Portfolio risk approaching 75% threshold', time: '12 min ago', agent: 'SentinelWatch' },
  { id: 4, type: 'success', message: 'DataMiner ETL pipeline completed — 12,847 rows processed', time: '18 min ago', agent: 'DataMiner' },
  { id: 5, type: 'info', message: 'PixelForge generated 3 banner variants for Campaign Q3', time: '25 min ago', agent: 'PixelForge' },
  { id: 6, type: 'error', message: 'DebugHound: Unresolved error in module auth.service.ts', time: '1 hour ago', agent: 'DebugHound' },
  { id: 7, type: 'success', message: 'StoryTeller published blog post "AI Agents in Production"', time: '2 hours ago', agent: 'StoryTeller' },
];

export const TRADING_DATA = {
  pairs: [
    { symbol: 'BTC/USD', price: '68,423.50', change: '+2.34%', changeDir: 'up', volume: '24.1B' },
    { symbol: 'ETH/USD', price: '3,847.20', change: '+1.87%', changeDir: 'up', volume: '12.8B' },
    { symbol: 'SOL/USD', price: '178.45', change: '-0.52%', changeDir: 'down', volume: '3.2B' },
  ],
  signals: [
    { pair: 'ETH/USD', direction: 'BUY', confidence: 87, timeframe: '4H', agent: 'MarketSense', time: '5 min ago' },
    { pair: 'BTC/USD', direction: 'HOLD', confidence: 62, timeframe: '1D', agent: 'MarketSense', time: '15 min ago' },
    { pair: 'SOL/USD', direction: 'SELL', confidence: 74, timeframe: '1H', agent: 'MarketSense', time: '30 min ago' },
  ],
  portfolio: {
    totalValue: '$142,847.50',
    dayChange: '+$3,247.20',
    dayChangePercent: '+2.32%',
  },
};

export const CODING_DATA = {
  files: [
    { name: 'src/', type: 'folder', children: [
      { name: 'index.ts', type: 'file', lang: 'typescript' },
      { name: 'auth.service.ts', type: 'file', lang: 'typescript' },
      { name: 'agent.controller.ts', type: 'file', lang: 'typescript' },
      { name: 'workflow.engine.ts', type: 'file', lang: 'typescript' },
    ]},
    { name: 'tests/', type: 'folder', children: [
      { name: 'auth.test.ts', type: 'file', lang: 'typescript' },
      { name: 'agent.test.ts', type: 'file', lang: 'typescript' },
    ]},
    { name: 'package.json', type: 'file', lang: 'json' },
    { name: 'tsconfig.json', type: 'file', lang: 'json' },
  ],
  activeFile: 'agent.controller.ts',
  code: [
    { num: 1, content: '<span class="syn-keyword">import</span> { Controller, Get, Post } <span class="syn-keyword">from</span> <span class="syn-string">\'@nestjs/common\'</span>;' },
    { num: 2, content: '<span class="syn-keyword">import</span> { AgentService } <span class="syn-keyword">from</span> <span class="syn-string">\'./agent.service\'</span>;' },
    { num: 3, content: '' },
    { num: 4, content: '<span class="syn-comment">// Agent controller handles all agent-related API endpoints</span>' },
    { num: 5, content: '<span class="syn-type">@Controller</span>(<span class="syn-string">\'agents\'</span>)' },
    { num: 6, content: '<span class="syn-keyword">export class</span> <span class="syn-type">AgentController</span> {' },
    { num: 7, content: '  <span class="syn-keyword">constructor</span>(<span class="syn-keyword">private readonly</span> <span class="syn-variable">agentService</span>: <span class="syn-type">AgentService</span>) {}' },
    { num: 8, content: '' },
    { num: 9, content: '  <span class="syn-type">@Get</span>()' },
    { num: 10, content: '  <span class="syn-keyword">async</span> <span class="syn-function">findAll</span>() {' },
    { num: 11, content: '    <span class="syn-keyword">return</span> <span class="syn-keyword">this</span>.<span class="syn-variable">agentService</span>.<span class="syn-function">findAll</span>();' },
    { num: 12, content: '  }' },
    { num: 13, content: '' },
    { num: 14, content: '  <span class="syn-type">@Post</span>(<span class="syn-string">\'run\'</span>)' },
    { num: 15, content: '  <span class="syn-keyword">async</span> <span class="syn-function">runAgent</span>(<span class="syn-variable">id</span>: <span class="syn-type">string</span>) {' },
    { num: 16, content: '    <span class="syn-keyword">const</span> <span class="syn-variable">agent</span> = <span class="syn-keyword">await this</span>.<span class="syn-variable">agentService</span>.<span class="syn-function">findById</span>(<span class="syn-variable">id</span>);' },
    { num: 17, content: '    <span class="syn-keyword">return</span> <span class="syn-variable">agent</span>.<span class="syn-function">execute</span>();' },
    { num: 18, content: '  }' },
    { num: 19, content: '}' },
  ],
  terminal: [
    { type: 'info', text: '$ npm run dev' },
    { type: 'success', text: '[NestJS] Application started on port 3000' },
    { type: 'info', text: '[AgentService] Loading 8 agents from registry...' },
    { type: 'success', text: '[AgentService] All agents initialized successfully' },
    { type: 'warning', text: '[DebugHound] Warning: auth.service.ts has 2 unresolved issues' },
    { type: 'info', text: '[Orchestrator] Scheduling nightly report for 00:00 UTC' },
  ],
};

export const CREATION_DATA = {
  items: [
    { id: 'cr-1', name: 'Hero Banner Q3', type: 'Image', status: 'completed', preview: '🖼️', agent: 'PixelForge', date: '2 hours ago' },
    { id: 'cr-2', name: 'Product Description', type: 'Copy', status: 'completed', preview: '📄', agent: 'StoryTeller', date: '3 hours ago' },
    { id: 'cr-3', name: 'Social Media Pack', type: 'Design', status: 'in-progress', preview: '🎯', agent: 'PixelForge', date: '5 hours ago' },
    { id: 'cr-4', name: 'Email Newsletter', type: 'Copy', status: 'completed', preview: '📧', agent: 'StoryTeller', date: '1 day ago' },
    { id: 'cr-5', name: 'Brand Guidelines', type: 'Document', status: 'draft', preview: '📋', agent: 'StoryTeller', date: '2 days ago' },
    { id: 'cr-6', name: 'App Screenshots', type: 'Image', status: 'completed', preview: '📱', agent: 'PixelForge', date: '3 days ago' },
  ],
  templates: [
    { name: 'Blog Post', icon: '📝', uses: 45 },
    { name: 'Social Post', icon: '📱', uses: 89 },
    { name: 'Email Campaign', icon: '📧', uses: 23 },
    { name: 'Landing Page', icon: '🌐', uses: 12 },
  ],
};

export const CHART_DATA = {
  agentPerformance: [65, 72, 80, 75, 90, 85, 88, 92, 87, 95, 91, 93],
  workflowRuns: [12, 19, 15, 25, 22, 30, 28, 35, 32, 38, 41, 45],
  memoryUsage: [40, 42, 45, 48, 44, 50, 55, 52, 58, 60, 62, 67],
  tradingPnL: [100, 105, 98, 112, 108, 120, 115, 128, 135, 130, 142, 148],
};

export const SESSIONS = [
  { id: 'sess-1', name: 'Trading Strategy Opt', agent: 'MarketSense', status: 'active', time: 'Started 2h ago' },
  { id: 'sess-2', name: 'Code Review PR #127', agent: 'CodeWeaver', status: 'completed', time: 'Ended 5m ago' },
  { id: 'sess-3', name: 'Asset Generation Q3', agent: 'PixelForge', status: 'active', time: 'Started 1h ago' },
  { id: 'sess-4', name: 'Data Pipeline ETL', agent: 'DataMiner', status: 'paused', time: 'Paused 30m ago' },
];

export const SYSTEM_STATUS = {
  health: 'Optimal',
  uptime: '99.99%',
  latency: '1.2ms',
  activeNodes: 12,
  cpuUsage: '42%',
  memoryLoad: '67%'
};

// ═══════════════════════════════════════════════════
// FSM TASK EXECUTION – Configuration & Sample Data
// ═══════════════════════════════════════════════════

export const TASK_EXECUTION_CONFIG = {
  defaultTimeouts: {
    planning: 5000,
    routing: 2000,
    executing: 30000,
    validating: 5000,
    persisting: 3000,
  },
  retryLimits: {
    maxRetries: 3,
    backoffMultiplier: 1.5,
  },
  checkpoints: {
    maxPerTask: 20,
    persistToStorage: true,
  },
  domainEngines: {
    coding: {
      name: 'Coding Engine',
      icon: '⟨/⟩',
      color: 'var(--coding-accent)',
      subStates: ['SCAN_REPO', 'PATCH_CODE', 'RUN_TESTS', 'FIX_ERRORS'],
    },
    trading: {
      name: 'Trading Engine',
      icon: '◇',
      color: 'var(--trading-accent)',
      subStates: ['MARKET_READ', 'SENTIMENT_CHECK', 'SETUP_GRADE', 'RISK_APPROVAL'],
    },
    creation: {
      name: 'Creation Engine',
      icon: '✦',
      color: 'var(--creation-accent)',
      subStates: ['IDEATE', 'DRAFT', 'CRITIQUE', 'POLISH'],
    },
  },
};

export const SAMPLE_TASKS = [
  {
    taskId: 'task-sample-1',
    state: 'COMPLETED',
    intent: 'Refactor auth.service.ts to use JWT middleware',
    domainEngine: 'coding',
    routedAgent: 'CodeWeaver',
    stepIndex: 12,
    retryCount: 0,
    startedAt: Date.now() - 3600000,
    completedAt: Date.now() - 3540000,
    validationResult: { passed: true, score: 97, checks: [
      { name: 'Output completeness', passed: true },
      { name: 'Quality threshold', passed: true },
      { name: 'Safety constraints', passed: true },
    ]},
    keyOutputs: {
      SCAN_REPO: { status: 'completed', duration: 820, output: 'Found 3 auth-related files' },
      PATCH_CODE: { status: 'completed', duration: 1450, output: 'Applied JWT middleware pattern' },
      RUN_TESTS: { status: 'completed', duration: 960, output: '12/12 tests passed' },
      FIX_ERRORS: { status: 'completed', duration: 340, output: 'No errors to fix' },
    },
    resourceIds: ['res-auth-jwt-001'],
    errorType: null,
    errorMessage: null,
  },
  {
    taskId: 'task-sample-2',
    state: 'COMPLETED',
    intent: 'Analyze BTC/USD 4H chart for swing trade setup',
    domainEngine: 'trading',
    routedAgent: 'MarketSense',
    stepIndex: 10,
    retryCount: 0,
    startedAt: Date.now() - 1800000,
    completedAt: Date.now() - 1740000,
    validationResult: { passed: true, score: 91, checks: [
      { name: 'Output completeness', passed: true },
      { name: 'Quality threshold', passed: true },
      { name: 'Safety constraints', passed: true },
    ]},
    keyOutputs: {
      MARKET_READ: { status: 'completed', duration: 1100, output: 'BTC at $68,423 with bullish divergence' },
      SENTIMENT_CHECK: { status: 'completed', duration: 900, output: 'Fear & Greed: 72 (Greed)' },
      SETUP_GRADE: { status: 'completed', duration: 750, output: 'A-grade swing setup' },
      RISK_APPROVAL: { status: 'completed', duration: 600, output: 'Risk within 2% threshold' },
    },
    resourceIds: ['res-btc-swing-002'],
    errorType: null,
    errorMessage: null,
  },
  {
    taskId: 'task-sample-3',
    state: 'FAILED',
    intent: 'Generate product landing page copy',
    domainEngine: 'creation',
    routedAgent: 'StoryTeller',
    stepIndex: 7,
    retryCount: 2,
    startedAt: Date.now() - 900000,
    completedAt: null,
    validationResult: { passed: false, score: 42, checks: [
      { name: 'Output completeness', passed: true },
      { name: 'Quality threshold', passed: false },
      { name: 'Safety constraints', passed: true },
    ]},
    keyOutputs: {
      IDEATE: { status: 'completed', duration: 1200, output: '5 concept directions generated' },
      DRAFT: { status: 'completed', duration: 1800, output: 'First draft produced' },
      CRITIQUE: { status: 'completed', duration: 900, output: 'Score below threshold' },
    },
    resourceIds: [],
    errorType: 'VALIDATION_FAILURE',
    errorMessage: 'Output did not meet quality threshold after 2 retries',
  },
];
