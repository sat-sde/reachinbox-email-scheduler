import { Client } from '@elastic/elasticsearch'
import { env } from './env'
import { logger } from '../utils/logger'

export const esClient = new Client({ node: env.ELASTICSEARCH_URL })

esClient.ping()
  .then(() => logger.info('✅ Elasticsearch connected'))
  .catch((err) => logger.error('Elasticsearch connection failed', err))

export const EMAIL_INDEX = 'emails'

