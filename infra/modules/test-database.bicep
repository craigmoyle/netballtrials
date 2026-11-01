targetScope = 'resourceGroup'

@description('Name of the existing shared PostgreSQL Flexible Server.')
param postgresServerName string

@description('Dedicated application database. This module creates only the database; it never creates or modifies the shared server.')
param databaseName string = 'netballtrials_test'

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' existing = {
  name: postgresServerName
}

resource testDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgresServer
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

output databaseName string = testDatabase.name
output postgresServerFqdn string = postgresServer.properties.fullyQualifiedDomainName
