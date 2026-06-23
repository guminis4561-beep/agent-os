/**
 * Configuration module for AI Agent Platform
 * Contains environment-specific settings and global constants
 */

export const CONFIG = {
  // Application details
  app: {
    name: 'HUGOFXLAB',
    version: '0.1.0',
    environment: 'development'
  },
  
  // API endpoints for different engines
  api: {
    coding: 'https://api.neura.ai/v1/coding',
    trading: 'https://api.neura.ai/v1/trading',
    creation: 'https://api.neura.ai/v1/creation'
  },
  
  // Default workspace settings
  workspace: {
    defaultTheme: 'dark',
    autoSaveIntervalMs: 30000, // 30 seconds
  },
  
  // Memory management thresholds
  memory: {
    maxShortTermItems: 100,
    cleanupThreshold: 0.8 // 80% capacity
  }
};

export default CONFIG;
