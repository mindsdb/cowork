# Executes the workflow's actual prerequisite checks with synthetic secrets.
require 'yaml'
require 'open3'

workflow = YAML.load_file(File.expand_path('../../../.github/workflows/build-android.yml', __dir__))
steps = workflow.fetch('jobs').fetch('play-internal').fetch('steps')
check = steps.find { |step| step['name'] == 'Check required secrets' }
write = steps.find { |step| step['name'] == 'Write google-services.json (if provided)' }
secrets = %w[ANDROID_UPLOAD_KEYSTORE_B64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD PLAY_SERVICE_ACCOUNT_JSON_B64]
sentinel = 'synthetic-secret-do-not-log'
base = secrets.to_h { |name| [name, sentinel] }
raise 'Firebase secret is not bound to the check' unless check.fetch('env').fetch('GOOGLE_SERVICES_JSON_B64') == '${{ secrets.GOOGLE_SERVICES_JSON_B64 }}'

%w[prod staging].each do |environment|
  ['', " \t\n", sentinel].each do |firebase|
    env = base.merge('COWORK_ENV' => environment, 'GOOGLE_SERVICES_JSON_B64' => firebase)
    output, status = Open3.capture2e(env, 'bash', '-e', '-c', check.fetch('run'), unsetenv_others: true)
    expected = environment == 'staging' || !firebase.strip.empty?
    raise "Wrong result for #{environment}, Firebase present=#{!firebase.strip.empty?}: #{output}" unless status.success? == expected
    raise 'Secret leaked to logs' if output.include?(sentinel)
    raise 'Missing Firebase not named' if !expected && !output.include?('GOOGLE_SERVICES_JSON_B64')
    if environment == 'staging' && firebase.strip.empty?
      output, status = Open3.capture2e(env, 'bash', '-e', '-c', write.fetch('run'), unsetenv_others: true)
      raise 'Staging must warn and continue without Firebase' unless status.success? && output.include?('::warning')
    end
  end
end

secrets.each do |missing|
  env = base.merge(missing => ' ', 'COWORK_ENV' => 'prod', 'GOOGLE_SERVICES_JSON_B64' => sentinel)
  output, status = Open3.capture2e(env, 'bash', '-e', '-c', check.fetch('run'), unsetenv_others: true)
  raise "Missing #{missing} did not fail" if status.success? || !output.include?(missing)
  raise 'Secret leaked to logs' if output.include?(sentinel)
end
puts 'Android release prerequisites: 11 cases passed; staging warnings preserved.'

# Exercise the caller's real path filter: workflow-only changes must run this guard.
require 'tmpdir'
caller = YAML.load_file(File.expand_path('../../../.github/workflows/dev-build-deploy.yml', __dir__))
filter = caller.fetch('jobs').fetch('mobile-changes').fetch('steps').find { |step| step['id'] == 'diff' }.fetch('run')
Dir.mktmpdir do |dir|
  gh = File.join(dir, 'gh')
  File.write(gh, "#!/bin/bash\nprintf '%s\\n' \"$TEST_FILES\"\n")
  File.chmod(0755, gh)
  {
    'mobile/package.json' => true,
    '.github/workflows/mobile-smoke.yml' => true,
    '.github/workflows/build-android.yml' => true,
    'src/renderer/App.tsx' => false,
    '.github/workflows/build-android.yml.bak' => false,
  }.each do |path, expected|
    output_file = File.join(dir, 'output')
    File.write(output_file, '')
    env = { 'PATH' => "#{dir}:/usr/bin:/bin", 'REPO' => 'example/repo', 'PR' => '1',
            'TEST_FILES' => path, 'GITHUB_OUTPUT' => output_file }
    output, status = Open3.capture2e(env, 'bash', '-e', '-c', filter, unsetenv_others: true)
    raise "Filter failed: #{output}" unless status.success?
    raise "Wrong smoke decision for #{path}" unless File.read(output_file).strip == "changed=#{expected}"
  end
end
puts 'Mobile smoke path filter: 5 cases passed.'
