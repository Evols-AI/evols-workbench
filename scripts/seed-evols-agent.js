#!/usr/bin/env node
/**
 * Seed the "Evols AI" agent into LibreChat's MongoDB.
 *
 * Idempotent — upserts on a fixed agent id so re-running updates rather than duplicates.
 * No login required — writes the agent document directly.
 * is_promoted=true makes it visible to all users without per-user setup.
 *
 * Usage:
 *   MONGO_URI=mongodb://localhost:27017/evols-workbench node scripts/seed-evols-agent.js
 *
 * Or via npm script (add to package.json):
 *   "seed:agent": "node scripts/seed-evols-agent.js"
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('Error: MONGO_URI environment variable is required');
  process.exit(1);
}

// ── Fixed agent identity ──────────────────────────────────────────────────────
const AGENT_ID = 'agent_evols_ai';
const AGENT_NAME = 'Evols AI';
const MCP_SERVER = 'evols';

const MCP_TOOLS = [
  `get_skill_details_mcp_${MCP_SERVER}`,
  `get_work_context_summary_mcp_${MCP_SERVER}`,
  `get_personas_mcp_${MCP_SERVER}`,
  `get_themes_mcp_${MCP_SERVER}`,
  `get_feedback_items_mcp_${MCP_SERVER}`,
  `get_product_strategy_mcp_${MCP_SERVER}`,
  `get_customer_segments_mcp_${MCP_SERVER}`,
  `get_competitive_landscape_mcp_${MCP_SERVER}`,
  `get_features_mcp_${MCP_SERVER}`,
  `get_past_skill_work_mcp_${MCP_SERVER}`,
];

// Sentinel ObjectId — stable system author, never tied to a real user account
const SYSTEM_AUTHOR_OID = new mongoose.Types.ObjectId('000000000000000000000001');

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Evols AI, an intelligent product management assistant with deep knowledge of the user's product, customers, and strategy.

## How to respond

When a user asks a question or requests analysis:

1. Call \`get_skill_details\` with the most relevant skill name to load expert instructions for that task.
2. Follow those instructions, calling the data tools the skill recommends.
3. For conversational questions that don't need a skill, use data tools directly.

## Available data tools

- \`get_work_context_summary\` — user's role, projects, tasks, and priorities
- \`get_personas\` — customer persona profiles
- \`get_themes\` — clustered feedback themes
- \`get_feedback_items\` — raw customer feedback
- \`get_product_strategy\` — product vision and strategic bets
- \`get_customer_segments\` — customer segment definitions
- \`get_competitive_landscape\` — competitive analysis
- \`get_features\` — product initiatives and RICE scores
- \`get_past_skill_work\` — prior AI-generated analyses and documents

## Principles

- Always ground responses in the user's actual product data — call tools before drawing conclusions.
- When generating documents (PRDs, analyses, strategy briefs), wrap them in the \`:::artifact:::\` markdown directive so they open in the document panel.
- Be concise in conversation but thorough in documents.
`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`→ Connecting to MongoDB…`);
  mongoose.set('strictQuery', true);
  await mongoose.connect(MONGO_URI, { bufferCommands: false });
  console.log('  Connected');

  const agentsCol = mongoose.connection.db.collection('agents');

  const now = new Date();

  const PROVIDER = process.env.EVOLS_AGENT_PROVIDER || 'Bedrock (AWS)';
  const MODEL = process.env.EVOLS_AGENT_MODEL || 'us.anthropic.claude-sonnet-4-6';

  const doc = {
    id: AGENT_ID,
    name: AGENT_NAME,
    description:
      'Your intelligent coworker, grounded in your proprietary data and equipped with expert skills for strategy, research, design, and execution.',
    instructions: SYSTEM_PROMPT,
    provider: PROVIDER,
    model: MODEL,
    tools: MCP_TOOLS,
    mcpServerNames: [MCP_SERVER],
    category: 'evols',
    is_promoted: true,
    author: SYSTEM_AUTHOR_OID,
    authorName: 'Evols',
    conversation_starters: [
      'What are my top customer pain points?',
      'Help me write a PRD for my next feature',
      'Run a SWOT analysis on our current strategy',
      'What should I prioritize on the roadmap this quarter?',
    ],
    edges: [],
    versions: [],
    tool_resources: {},
    updatedAt: now,
  };

  const result = await agentsCol.updateOne(
    { id: AGENT_ID },
    {
      $set: doc,
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  if (result.upsertedCount > 0) {
    console.log(`✓ Created agent '${AGENT_NAME}' (id: ${AGENT_ID})`);
  } else {
    console.log(`✓ Updated agent '${AGENT_NAME}' (id: ${AGENT_ID})`);
  }

  // Fetch the agent's MongoDB _id so we can set the ACL entry
  const agent = await agentsCol.findOne({ id: AGENT_ID }, { projection: { _id: 1 } });
  const agentObjectId = agent._id;

  // Upsert a PUBLIC VIEW ACL entry so all users can see this agent in @ mentions
  // principalType: 'public' + permBits: 1 (VIEW) matches findPubliclyAccessibleResources
  const aclCol = mongoose.connection.db.collection('aclentries');
  const aclResult = await aclCol.updateOne(
    { principalType: 'public', resourceType: 'agent', resourceId: agentObjectId },
    {
      $set: {
        principalType: 'public',
        resourceType: 'agent',
        resourceId: agentObjectId,
        permBits: 1,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  if (aclResult.upsertedCount > 0) {
    console.log(`✓ Created PUBLIC VIEW ACL entry for agent`);
  } else {
    console.log(`✓ ACL entry already exists for agent`);
  }

  console.log(`\n  Model:  ${MODEL} via ${PROVIDER}`);
  console.log(`  Tools:  ${MCP_TOOLS.length} MCP tools`);
  console.log(`\nThe 'Evols AI' agent is now available to all users in LibreChat.`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
