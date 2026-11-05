param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$packageSource=(Resolve-Path -LiteralPath $Source).ProviderPath
$packageDestination=[IO.Path]::GetFullPath($Destination)
if($packageDestination.StartsWith($packageSource+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Archive cannot be inside its source directory.'}
if(Test-Path -LiteralPath $packageDestination){throw 'Archive already exists.'}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($packageDestination)) | Out-Null
$archive=[IO.Compression.ZipFile]::Open($packageDestination,[IO.Compression.ZipArchiveMode]::Create)
try{
  foreach($file in Get-ChildItem -LiteralPath $packageSource -Recurse -File){
    $name=([IO.Path]::GetFileName($packageSource)+'/'+$file.FullName.Substring($packageSource.Length+1)).Replace('\','/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
}finally{$archive.Dispose()}
