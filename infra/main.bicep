targetScope = 'subscription'

@description('Short azd environment name.')
param environmentName string = 'test'

@description('Region for the Trials resource group and Container App. The existing shared Container Apps environment is in Australia East.')
param location string = 'australiaeast'

@description('Dedicated resource group for the Netball Trials TEST app resources.')
param resourceGroupName string = 'rg-netballtrials-test'

@description('Existing Netball Stats resource group that contains the shared Container Apps environment, registry, and PostgreSQL server.')
param sharedResourceGroupName string = 'rg-netballstats-audljf'

@description('Existing VNet-integrated Container Apps environment.')
param sharedContainerAppsEnvironmentName string = 'netballstats-aca-env-wr5i2l'

@description('Name of the existing shared Azure Container Registry.')
param sharedContainerRegistryName string

@description('Existing private Azure Database for PostgreSQL Flexible Server.')
param sharedPostgresServerName string = 'netballstats-wr5i2l-pg'

@description('Dedicated database created on the existing PostgreSQL server.')
param postgresDatabaseName string = 'netballtrials_test'

@description('Location supported by Azure Static Web Apps. This is separate from the Australia East API region.')
param staticWebAppLocation string = 'eastasia'

@description('Full PostgreSQL connection string for the dedicated TEST database and restricted application user. Stored as a Container App secret.')
@secure()
param databaseUrl string

@description('Comma-separated allowlisted TEST Admin emails (maximum five). Stored as a Container App secret.')
@secure()
param testAdminEmails string

@description('Infisical project ID for the dedicated TEST project.')
param infisicalProjectId string

@description('Infisical Universal Auth client ID. Stored as a Container App secret.')
@secure()
param infisicalUniversalAuthClientId string

@description('Infisical Universal Auth client secret. Stored as a Container App secret.')
@secure()
param infisicalUniversalAuthClientSecret string

@description('Infisical secret path scoped to the TEST integration records.')
param infisicalPath string = '/'

@description('Infisical Cloud API endpoint.')
@allowed([
  'https://us.infisical.com'
  'https://eu.infisical.com'
])
param infisicalApiUrl string = 'https://us.infisical.com'

@description('API image name for the initial provision. The manual promotion workflow replaces this placeholder.')
param apiImageName string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Migration-job image name for the initial provision. The manual promotion workflow replaces this placeholder before running migrations.')
param apiMigrationImageName string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Tags applied to new Trials resources.')
param tags object = {
  application: 'netballtrials'
  environment: 'test'
}

resource appResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: union(tags, { 'azd-env-name': environmentName })
}

module testDatabase './modules/test-database.bicep' = {
  name: 'netballtrials-test-database-${environmentName}'
  scope: resourceGroup(sharedResourceGroupName)
  params: {
    postgresServerName: sharedPostgresServerName
    databaseName: postgresDatabaseName
  }
}

module appStack './modules/app-stack.bicep' = {
  name: 'netballtrials-app-${environmentName}'
  scope: appResourceGroup
  params: {
    environmentName: environmentName
    location: location
    tags: union(tags, { 'azd-env-name': environmentName })
    sharedResourceGroupName: sharedResourceGroupName
    sharedContainerAppsEnvironmentName: sharedContainerAppsEnvironmentName
    sharedContainerRegistryName: sharedContainerRegistryName
    staticWebAppLocation: staticWebAppLocation
    databaseUrl: databaseUrl
    testAdminEmails: testAdminEmails
    infisicalProjectId: infisicalProjectId
    infisicalUniversalAuthClientId: infisicalUniversalAuthClientId
    infisicalUniversalAuthClientSecret: infisicalUniversalAuthClientSecret
    infisicalPath: infisicalPath
    infisicalApiUrl: infisicalApiUrl
    apiImageName: apiImageName
    apiMigrationImageName: apiMigrationImageName
  }
  dependsOn: [
    testDatabase
  ]
}

output appResourceGroupName string = appResourceGroup.name
output staticWebAppName string = appStack.outputs.staticWebAppName
output staticWebAppHostname string = appStack.outputs.staticWebAppHostname
output staticWebAppUrl string = appStack.outputs.staticWebAppUrl
output apiContainerAppName string = appStack.outputs.apiContainerAppName
output apiContainerAppFqdn string = appStack.outputs.apiContainerAppFqdn
output apiContainerAppUrl string = appStack.outputs.apiContainerAppUrl
output migrationJobName string = appStack.outputs.migrationJobName
output containerRegistryLoginServer string = appStack.outputs.containerRegistryLoginServer
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = appStack.outputs.containerRegistryLoginServer
output postgresServerFqdn string = testDatabase.outputs.postgresServerFqdn
output postgresDatabaseName string = testDatabase.outputs.databaseName
