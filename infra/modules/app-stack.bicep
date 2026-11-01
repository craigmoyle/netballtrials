targetScope = 'resourceGroup'

@description('Short azd environment name.')
param environmentName string

@description('Region for the Trials API resources.')
param location string

@description('Tags applied to new resources.')
param tags object = {}

@description('Resource group containing the shared Netball Stats infrastructure.')
param sharedResourceGroupName string

@description('Existing VNet-integrated Container Apps environment.')
param sharedContainerAppsEnvironmentName string

@description('Existing shared Azure Container Registry.')
param sharedContainerRegistryName string

@description('Region supported by Azure Static Web Apps.')
param staticWebAppLocation string

@description('Full PostgreSQL connection string for the dedicated TEST database.')
@secure()
param databaseUrl string

@description('Comma-separated TEST Admin allowlist, stored as an application secret.')
@secure()
param testAdminEmails string

@description('Infisical TEST project ID.')
param infisicalProjectId string

@description('Infisical Universal Auth client ID.')
@secure()
param infisicalUniversalAuthClientId string

@description('Infisical Universal Auth client secret.')
@secure()
param infisicalUniversalAuthClientSecret string

@description('Infisical TEST secret path.')
param infisicalPath string

@description('Infisical Cloud API endpoint.')
param infisicalApiUrl string

@description('Initial API image; the protected promotion workflow replaces it.')
param apiImageName string

@description('Initial migration image; the protected promotion workflow replaces it before running migrations.')
param apiMigrationImageName string

@description('Optional exact proxy IPs/CIDRs trusted by Fastify. Leave empty unless verified for the shared ACA ingress.')
param trustProxy string = ''

var resourceToken = toLower(take(uniqueString(subscription().id, resourceGroup().id, environmentName), 6))
var staticWebAppName = take('netballtrials-test-web-${resourceToken}', 40)
var apiContainerAppName = take('netballtrials-test-api-${resourceToken}', 32)
var migrationJobName = take('netballtrials-migrate-test-${resourceToken}', 32)
var apiPort = 3000
var apiFqdn = '${apiContainerAppName}.${sharedContainerAppsEnvironment.properties.defaultDomain}'
var apiUrl = 'https://${apiFqdn}'
var staticWebAppUrlValue = 'https://${staticWebApp.properties.defaultHostname}'

resource sharedContainerAppsEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' existing = {
  name: sharedContainerAppsEnvironmentName
  scope: resourceGroup(sharedResourceGroupName)
}

resource sharedContainerRegistry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: sharedContainerRegistryName
  scope: resourceGroup(sharedResourceGroupName)
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: take('netballtrials-test-api-mi-${resourceToken}', 64)
  location: location
  tags: tags
}

module apiAcrPullAssignment './assign-acr-pull.bicep' = {
  name: 'assign-trials-api-acr-pull-${resourceToken}'
  scope: resourceGroup(sharedResourceGroupName)
  params: {
    sharedContainerRegistryName: sharedContainerRegistryName
    principalId: apiIdentity.properties.principalId
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2025-03-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

resource apiContainerApp 'Microsoft.App/containerApps@2025-07-01' = {
  name: apiContainerAppName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${apiIdentity.id}': {}
    }
  }
  tags: union(tags, { 'azd-service-name': 'api' })
  properties: {
    managedEnvironmentId: sharedContainerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: apiPort
        transport: 'Auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: sharedContainerRegistry.properties.loginServer
          identity: apiIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          value: databaseUrl
        }
        {
          name: 'infisical-client-id'
          value: infisicalUniversalAuthClientId
        }
        {
          name: 'infisical-client-secret'
          value: infisicalUniversalAuthClientSecret
        }
        {
          name: 'test-admin-emails'
          value: testAdminEmails
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImageName
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'APP_ENV', value: 'testing' }
            { name: 'PAYMENT_PROVIDER', value: 'stripe' }
            { name: 'ENABLE_TEST_INTEGRATIONS', value: 'true' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'WEB_ORIGIN', value: staticWebAppUrlValue }
            { name: 'API_PUBLIC_URL', value: apiUrl }
            { name: 'SESSION_COOKIE_SECURE', value: 'true' }
            { name: 'TEST_ADMIN_EMAILS', secretRef: 'test-admin-emails' }
            { name: 'TEST_EMAIL_ALLOWLIST', value: 'cmoyle@gmail.com' }
            { name: 'MAIL_FROM', value: 'cmoyle@gmail.com' }
            { name: 'MAIL_REPLY_TO', value: 'cmoyle@gmail.com' }
            { name: 'INFISICAL_API_URL', value: infisicalApiUrl }
            { name: 'INFISICAL_UNIVERSAL_AUTH_CLIENT_ID', secretRef: 'infisical-client-id' }
            { name: 'INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET', secretRef: 'infisical-client-secret' }
            { name: 'INFISICAL_PROJECT_ID', value: infisicalProjectId }
            { name: 'INFISICAL_ENVIRONMENT', value: 'test' }
            { name: 'INFISICAL_SECRET_PATH', value: infisicalPath }
            { name: 'PORT', value: string(apiPort) }
            { name: 'TRUST_PROXY', value: trustProxy }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: { path: '/health', port: apiPort, scheme: 'HTTP' }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 12
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: apiPort, scheme: 'HTTP' }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: apiPort, scheme: 'HTTP' }
              initialDelaySeconds: 30
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    apiAcrPullAssignment
  ]
}

resource migrationJob 'Microsoft.App/jobs@2025-02-02-preview' = {
  name: migrationJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${apiIdentity.id}': {}
    }
  }
  properties: {
    environmentId: sharedContainerAppsEnvironment.id
    configuration: {
      triggerType: 'Manual'
      manualTriggerConfig: {
        replicaCompletionCount: 1
        parallelism: 1
      }
      replicaTimeout: 1800
      replicaRetryLimit: 0
      registries: [
        {
          server: sharedContainerRegistry.properties.loginServer
          identity: apiIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-url'
          value: databaseUrl
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: apiMigrationImageName
          command: [
            'npm'
            'exec'
            '--workspace=@netball-trials/api'
            '--'
            'prisma'
            'migrate'
            'deploy'
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'APP_ENV', value: 'testing' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
        }
      ]
    }
  }
  dependsOn: [
    apiAcrPullAssignment
  ]
}

resource staticWebAppLinkedBackend 'Microsoft.Web/staticSites/linkedBackends@2025-03-01' = {
  parent: staticWebApp
  name: 'api'
  kind: 'ContainerApp'
  properties: {
    backendResourceId: apiContainerApp.id
    region: location
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output staticWebAppUrl string = staticWebAppUrlValue
output apiContainerAppName string = apiContainerApp.name
output apiContainerAppFqdn string = apiFqdn
output apiContainerAppUrl string = apiUrl
output migrationJobName string = migrationJob.name
output containerRegistryLoginServer string = sharedContainerRegistry.properties.loginServer
