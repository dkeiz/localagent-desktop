'use strict';

const CONNECTOR_NAME = 'telegram-relay';

function parseBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

async function setConnectorConfig(context, key, value) {
  await context.connectors.setConfig(CONNECTOR_NAME, key, value == null ? '' : String(value));
}

async function syncPluginConfigToConnector(context) {
  const config = context.getConfig();
  await setConnectorConfig(context, 'botToken', config.botToken || '');
  await setConnectorConfig(context, 'telegramReadingEnabled', parseBool(config.telegramReadingEnabled, false) ? 'true' : 'false');
  await setConnectorConfig(context, 'duplicateTelegramChat', parseBool(config.duplicateTelegramChat, true) ? 'true' : 'false');
  await setConnectorConfig(context, 'ownerChatId', config.ownerChatId || '');
}

async function isConnectorRunning(context) {
  const list = await context.connectors.list();
  const current = list.find((item) => item.name === CONNECTOR_NAME);
  return String(current?.status || '').toLowerCase() === 'running';
}

async function ensureStopped(context) {
  if (!(await isConnectorRunning(context))) return;
  try {
    await context.connectors.stop(CONNECTOR_NAME);
  } catch (error) {
    context.log(`Stop connector warning: ${error.message}`);
  }
}

async function ensureStarted(context) {
  const botToken = String(context.getConfig('botToken') || '').trim();
  if (!botToken) {
    context.log('Telegram reading requested but botToken is empty');
    return { success: false, error: 'botToken is required' };
  }
  if (await isConnectorRunning(context)) {
    return { success: true, running: true };
  }
  return context.connectors.start(CONNECTOR_NAME);
}

async function applyReadingState(context) {
  const readingEnabled = parseBool(context.getConfig('telegramReadingEnabled'), false);
  if (!readingEnabled) {
    await ensureStopped(context);
    return { success: true, running: false };
  }
  return ensureStarted(context);
}

async function ensureDefaults(context) {
  const defaults = {
    botToken: '',
    telegramReadingEnabled: 'false',
    duplicateTelegramChat: 'true',
    ownerChatId: ''
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (context.getConfig(key) == null) {
      await context.setConfig(key, value);
    }
  }
}

module.exports = {
  async onEnable(context) {
    await ensureDefaults(context);
    await syncPluginConfigToConnector(context);
    await applyReadingState(context);
    context.log('Telegram plugin enabled');
  },

  async onDisable(context) {
    if (context) {
      await ensureStopped(context);
    }
  },

  async onConfigChanged(key, value, context) {
    await setConnectorConfig(context, key, value);

    if (key === 'telegramReadingEnabled') {
      await applyReadingState(context);
      return;
    }

    if (key === 'botToken') {
      const readingEnabled = parseBool(context.getConfig('telegramReadingEnabled'), false);
      if (readingEnabled) {
        await ensureStopped(context);
        await ensureStarted(context);
      }
    }
  },

  async runAction(action, params = {}, context) {
    if (action === 'discover' || action === 'status') {
      const running = await isConnectorRunning(context);
      return {
        success: true,
        connector: CONNECTOR_NAME,
        readingEnabled: parseBool(context.getConfig('telegramReadingEnabled'), false),
        duplicateTelegramChat: parseBool(context.getConfig('duplicateTelegramChat'), true),
        ownerChatId: String(context.getConfig('ownerChatId') || ''),
        running
      };
    }

    if (action === 'start-reading') {
      await context.setConfig('telegramReadingEnabled', 'true');
      return applyReadingState(context);
    }

    if (action === 'stop-reading') {
      await context.setConfig('telegramReadingEnabled', 'false');
      return applyReadingState(context);
    }

    if (action === 'set-owner') {
      const ownerChatId = String(params.chatId || params.ownerChatId || '').trim();
      await context.setConfig('ownerChatId', ownerChatId);
      await setConnectorConfig(context, 'ownerChatId', ownerChatId);
      return { success: true, ownerChatId };
    }

    throw new Error(`Unknown plugin action: ${action}`);
  }
};
