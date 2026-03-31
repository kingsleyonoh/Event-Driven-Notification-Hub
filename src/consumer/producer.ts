import { Kafka, type Producer } from 'kafkajs';

let kafkaClient: Kafka | null = null;
let producer: Producer | null = null;

export function getKafkaClient(brokers: string[]): Kafka {
  if (!kafkaClient) {
    kafkaClient = new Kafka({
      clientId: 'notification-hub',
      brokers,
    });
  }
  return kafkaClient;
}

export async function getProducer(brokers: string[]): Promise<Producer> {
  if (!producer) {
    const kafka = getKafkaClient(brokers);
    producer = kafka.producer();
    await producer.connect();
  }
  return producer;
}

export async function publishEvent(
  brokers: string[],
  topic: string,
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  const p = await getProducer(brokers);
  await p.send({
    topic,
    messages: [{ key, value: JSON.stringify(value) }],
  });
}

export async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}

export function resetKafkaClient(): void {
  kafkaClient = null;
  producer = null;
}
