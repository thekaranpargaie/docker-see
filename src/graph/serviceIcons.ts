/**
 * Picks a glyph for a service based on its image or its name, so the diagram is
 * scannable at a glance (roadmap v0.2 "service icons").
 */

const IMAGE_ICONS: [RegExp, string][] = [
	[/(^|\/)postgres|postgis|timescale/i, '🐘'],
	[/(^|\/)mysql|mariadb|percona/i, '🐬'],
	[/(^|\/)mongo/i, '🍃'],
	[/(^|\/)redis|valkey|keydb/i, '🧠'],
	[/(^|\/)memcached/i, '💾'],
	[/(^|\/)rabbitmq/i, '🐰'],
	[/(^|\/)kafka|zookeeper|redpanda|pulsar/i, '📨'],
	[/(^|\/)nats/i, '📡'],
	[/(^|\/)elasticsearch|opensearch|solr|meilisearch|typesense/i, '🔍'],
	[/(^|\/)kibana|grafana|metabase|superset/i, '📊'],
	[/(^|\/)prometheus|victoriametrics/i, '🔥'],
	[/(^|\/)loki|fluentd|logstash|vector/i, '🪵'],
	[/(^|\/)jaeger|tempo|zipkin|otel|opentelemetry/i, '🧭'],
	[/(^|\/)nginx|caddy|httpd|apache|envoy/i, '🌐'],
	[/(^|\/)traefik|haproxy|kong/i, '🚦'],
	[/(^|\/)minio|ceph|seaweedfs/i, '🪣'],
	[/(^|\/)clickhouse|cassandra|scylla|influxdb|cockroach/i, '🗄️'],
	[/(^|\/)node|bun|deno/i, '🟩'],
	[/(^|\/)python|django|flask/i, '🐍'],
	[/(^|\/)golang|(^|\/)go:/i, '🐹'],
	[/(^|\/)openjdk|(^|\/)java|tomcat|maven|gradle/i, '☕'],
	[/(^|\/)php|wordpress|laravel/i, '🐦'],
	[/(^|\/)ruby|rails/i, '💎'],
	[/(^|\/)rust/i, '🦀'],
	[/(^|\/)dotnet|aspnet|mcr\.microsoft/i, '🟪'],
	[/(^|\/)nextjs|next|react|vue|angular|vite/i, '⚛️'],
	[/(^|\/)keycloak|vault|authelia|oauth/i, '🔑'],
	[/(^|\/)mailhog|mailpit|maildev|postfix|smtp/i, '📧'],
	[/(^|\/)adminer|pgadmin|phpmyadmin/i, '🧰'],
	[/(^|\/)jenkins|drone|gitlab|woodpecker/i, '🤖'],
	[/(^|\/)sonarqube/i, '🧪'],
	[/(^|\/)selenium|playwright|cypress/i, '🕹️'],
	[/(^|\/)localstack|aws/i, '☁️'],
	[/(^|\/)ollama|llama|vllm/i, '🦙'],
	[/(^|\/)busybox|alpine|ubuntu|debian/i, '📦'],
];

const NAME_ICONS: [RegExp, string][] = [
	[/(^|[-_])(db|database|postgres|pg)([-_]|$)/i, '🐘'],
	[/(^|[-_])(cache|redis)([-_]|$)/i, '🧠'],
	[/(^|[-_])(queue|broker|mq|worker)([-_]|$)/i, '📨'],
	[/(^|[-_])(api|backend|server)([-_]|$)/i, '⚙️'],
	[/(^|[-_])(web|frontend|ui|client)([-_]|$)/i, '🖥️'],
	[/(^|[-_])(proxy|gateway|lb|ingress)([-_]|$)/i, '🚦'],
	[/(^|[-_])(mail|smtp)([-_]|$)/i, '📧'],
	[/(^|[-_])(test|e2e)([-_]|$)/i, '🧪'],
	[/(^|[-_])(migrate|migration|seed|init)([-_]|$)/i, '🌱'],
];

/** Default glyph, matching the node mock-up in the spec (§8). */
export const DEFAULT_SERVICE_ICON = '🐳';

export function pickServiceIcon(name: string, image?: string): string {
	if (image) {
		for (const [pattern, icon] of IMAGE_ICONS) {
			if (pattern.test(image)) {
				return icon;
			}
		}
	}
	for (const [pattern, icon] of NAME_ICONS) {
		if (pattern.test(name)) {
			return icon;
		}
	}
	return DEFAULT_SERVICE_ICON;
}
