$cpu = Get-CimInstance Win32_Processor |
  Select-Object Name, NumberOfCores, NumberOfLogicalProcessors
$memory = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
$gpu = Get-CimInstance Win32_VideoController |
  Select-Object Name, AdapterRAM, DriverVersion
[ordered]@{
  platform = "windows"
  cpu = $cpu
  memoryBytes = $memory
  gpu = $gpu
} | ConvertTo-Json -Depth 5
