const { execSync } = require('child_process');

console.log('🔧 Setting up KV namespace for Package Control Discord Bot...\n');

try {
  // Create KV namespace for production
  console.log('Creating production KV namespace...');
  const prodResult = execSync('npx wrangler kv:namespace create "PACKAGE_CACHE"', { encoding: 'utf8' });
  console.log(prodResult);

  // Create KV namespace for preview
  console.log('\nCreating preview KV namespace...');
  const previewResult = execSync('npx wrangler kv:namespace create "PACKAGE_CACHE" --preview', { encoding: 'utf8' });
  console.log(previewResult);

  console.log('\n✅ KV namespaces created successfully!');
  console.log('\n📝 Next steps:');
  console.log('1. Copy the namespace IDs from above');
  console.log('2. Update wrangler.toml with the correct IDs');
  console.log('3. Deploy your worker with: wrangler deploy');

} catch (error) {
  console.error('❌ Error creating KV namespace:', error.message);
  console.log('\n💡 Manual setup:');
  console.log('1. Run: wrangler kv:namespace create "PACKAGE_CACHE"');
  console.log('2. Run: wrangler kv:namespace create "PACKAGE_CACHE" --preview');
  console.log('3. Update wrangler.toml with the returned IDs');
} 