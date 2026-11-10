// robots.txt for one crawl: fetched once per origin, RFC 9309 failure semantics,
// user overrides from the robots page, and crawl-delay (which the matcher
// library ignores, so it is collected with a parse handler of our own).

import { RobotsMatcher, RobotsParseHandler, parseRobotsTxt } from 'google-robotstxt-parser';

const ROBOTS_TIMEOUT_MS = 10_000;
const MAX_CRAWL_DELAY_MS = 60_000;
const MAX_REMEMBERED_ORIGINS = 200;

export function extractBotName(userAgent) {
  if (!userAgent) return '*';
  const compatible = userAgent.match(/\bcompatible;\s*([A-Za-z][A-Za-z-]*)/);
  if (compatible) return compatible[1];
  return userAgent.match(/^([A-Za-z][A-Za-z-]+)\//)?.[1] ?? '*';
}

class CrawlDelayCollector extends RobotsParseHandler {
  constructor(agent) {
    super();
    this.agent = agent.toLowerCase();
    this.groupAgents = [];
    this.inAgentLines = false;
    this.specific = null;
    this.global = null;
  }

  handleUserAgent(_line, value) {
    if (!this.inAgentLines) this.groupAgents = [];
    this.inAgentLines = true;
    this.groupAgents.push(value.toLowerCase());
  }

  handleAllow() { this.inAgentLines = false; }
  handleDisallow() { this.inAgentLines = false; }

  handleUnknownAction(_line, action, value) {
    this.inAgentLines = false;
    if (action.toLowerCase().replace('_', '-') !== 'crawl-delay') return;
    const seconds = Number.parseFloat(value);
    if (Number.isNaN(seconds) || seconds < 0) return;
    if (this.groupAgents.includes(this.agent)) this.specific ??= seconds;
    if (this.groupAgents.includes('*')) this.global ??= seconds;
  }
}

function crawlDelayMs(text, agent) {
  const collector = new CrawlDelayCollector(agent);
  parseRobotsTxt(text, collector);
  const seconds = collector.specific ?? collector.global ?? 0;
  return Math.min(MAX_CRAWL_DELAY_MS, seconds * 1000);
}

const allowAll = source => ({ allowed: () => true, crawlDelayMs: 0, source, reason: '' });
const disallowAll = (source, reason) => ({ allowed: () => false, crawlDelayMs: 0, source, reason });

function fromText(text, agent, source) {
  if (!text.trim()) return allowAll(source);
  return {
    allowed: url => new RobotsMatcher().oneAgentAllowedByRobots(text, agent, url),
    crawlDelayMs: crawlDelayMs(text, agent),
    source,
    reason: 'disallowed by robots.txt',
  };
}

async function remember(origin, text) {
  const { robotsFetched = {} } = await chrome.storage.local.get('robotsFetched');
  delete robotsFetched[origin];
  robotsFetched[origin] = text;
  const origins = Object.keys(robotsFetched);
  for (const old of origins.slice(0, Math.max(0, origins.length - MAX_REMEMBERED_ORIGINS))) {
    delete robotsFetched[old];
  }
  await chrome.storage.local.set({ robotsFetched });
}

// One cache per crawl: a new crawl must see robots.txt changes and new overrides.
export function createRobots({ userAgent, overrides = {} }) {
  const agent = extractBotName(userAgent);
  const cache = new Map();
  let writes = Promise.resolve();

  async function load(origin) {
    if (origin in overrides) return fromText(overrides[origin], agent, 'override');
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        cache: 'no-cache',
        credentials: 'omit',
        signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      });
      if (response.ok) {
        const text = await response.text();
        // Serialized: concurrent origins would otherwise lose each other's update.
        writes = writes.then(() => remember(origin, text)).catch(() => {});
        return fromText(text, agent, 'fetched');
      }
      if (response.status < 500) return allowAll(`http-${response.status}`);
      return disallowAll(`http-${response.status}`, `robots.txt returned ${response.status}`);
    } catch (e) {
      return disallowAll('unreachable', `robots.txt unreachable: ${e.message}`);
    }
  }

  return {
    agent,
    get(origin) {
      if (!cache.has(origin)) cache.set(origin, load(origin));
      return cache.get(origin);
    },
  };
}
