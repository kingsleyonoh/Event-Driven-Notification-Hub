import { getKafkaClient } from './producer.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('lag-monitor');
const LAG_WARN_THRESHOLD = 500;

export async function checkConsumerLag(
  brokers: string[],
  groupId: string,
): Promise<number> {
  const kafka = getKafkaClient(brokers);
  const admin = kafka.admin();

  try {
    await admin.connect();

    const offsets = await admin.fetchOffsets({ groupId });
    let totalLag = 0;

    for (const topicOffsets of offsets) {
      const topicEnd = await admin.fetchTopicOffsets(topicOffsets.topic);
      const endMap = new Map(topicEnd.map((p) => [p.partition, Number(p.offset)]));

      for (const partition of topicOffsets.partitions) {
        const consumerOffset = Number(partition.offset);
        const endOffset = endMap.get(partition.partition) ?? 0;
        const lag = Math.max(0, endOffset - consumerOffset);
        totalLag += lag;
      }
    }

    if (totalLag > LAG_WARN_THRESHOLD) {
      logger.warn({ lag: totalLag, groupId, threshold: LAG_WARN_THRESHOLD }, 'consumer lag exceeds threshold');
    } else {
      logger.debug({ lag: totalLag, groupId }, 'consumer lag check');
    }

    return totalLag;
  } finally {
    await admin.disconnect();
  }
}
