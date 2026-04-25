# Redpanda external listener is on 19092, not 9092

- **Symptom:** Local Kafka client cannot connect to Redpanda when using `localhost:9092` — connection refused or hangs.
- **Cause:** Redpanda configures TWO listeners — internal (9092, container-network only) and external (19092, host-mapped). The internal port is NOT exposed to the host. Mapping `9092:9092` in docker-compose creates a phantom binding that doesn't actually route messages externally.
- **Solution:** Use `localhost:19092` for any client running on the host. Remove the `9092:9092` host mapping from `docker-compose.yml`. Set `KAFKA_BROKERS=localhost:19092` in `.env`.
- **Discovered in:** Event-Driven Notification Hub, Docker setup (2026-03-31).
- **Affects:** Local development against Redpanda. Production Kafka is unaffected.
