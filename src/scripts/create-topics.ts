import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { Kafka } from 'kafkajs';
import { loadConfig } from '../config.js';

const TOPICS = ['events.notifications'];

async function createTopics() {
  const config = loadConfig();
  const kafka = new Kafka({
    brokers: config.KAFKA_BROKERS,
    clientId: 'topic-creator',
  });

  const admin = kafka.admin();
  await admin.connect();

  console.log('Creating topics...');

  await admin.createTopics({
    topics: TOPICS.map((topic) => ({
      topic,
      numPartitions: 3,
      replicationFactor: 1,
    })),
  });

  const existingTopics = await admin.listTopics();
  for (const topic of TOPICS) {
    const exists = existingTopics.includes(topic);
    console.log(`  ${exists ? '✓' : '✗'} ${topic}`);
  }

  await admin.disconnect();
  console.log('Done.');
}

createTopics().catch((err) => {
  console.error('Failed to create topics:', err.message);
  process.exit(1);
});
