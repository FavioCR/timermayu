// Campo de teléfono con país, al estilo de shadcn-phone-input (MIT) sobre react-phone-number-input (MIT):
// bandera con buscador de país, el número con el formato de ese país y el valor en E.164 (+50688887777).
import * as React from "react"
import { CheckIcon, ChevronsUpDown } from "lucide-react"
import * as RPNInput from "react-phone-number-input"
import flags from "react-phone-number-input/flags"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type PhoneInputProps = Omit<React.ComponentProps<"input">, "onChange" | "value" | "ref"> &
  Omit<RPNInput.Props<typeof RPNInput.default>, "onChange"> & {
    onChange?: (value: RPNInput.Value) => void
  }

function PhoneInput({ className, onChange, value, ...props }: PhoneInputProps) {
  return (
    <RPNInput.default
      className={cn("flex", className)}
      flagComponent={FlagComponent}
      countrySelectComponent={CountrySelect}
      inputComponent={InputComponent}
      smartCaret={false}
      value={value || undefined}
      // Vacío llega como undefined; se entrega "" para que el campo controlado se limpie.
      onChange={(nuevo) => onChange?.(nuevo || ("" as RPNInput.Value))}
      {...props}
    />
  )
}

function InputComponent({ className, ...props }: React.ComponentProps<"input">) {
  return <Input className={cn("rounded-s-none", className)} {...props} />
}

type CountryEntry = { label: string; value: RPNInput.Country | undefined; divider?: boolean }

type CountrySelectProps = {
  disabled?: boolean
  value: RPNInput.Country
  options: CountryEntry[]
  onChange: (country: RPNInput.Country) => void
}

function CountrySelect({ disabled, value: selectedCountry, options: countryList, onChange }: CountrySelectProps) {
  const [open, setOpen] = React.useState(false)
  const nombre = countryList.find((option) => option.value === selectedCountry)?.label
  return (
    // modal: dentro de un Dialog, la lista se puede desplazar con la rueda.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="flex gap-1 rounded-e-none border-r-0 px-3 focus:z-10"
          disabled={disabled}
          aria-label={nombre ? `País: ${nombre}` : "Elegir país"}
        >
          <FlagComponent country={selectedCountry} countryName={nombre ?? selectedCountry} />
          <ChevronsUpDown className={cn("-mr-2 size-4 opacity-50", disabled && "hidden")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar país o código…" />
          <CommandList>
            <CommandEmpty>No hay un país con ese nombre.</CommandEmpty>
            <CommandGroup>
              {countryList.map(({ value, label, divider }, indice) =>
                divider ? (
                  <CommandSeparator key={`separador-${indice}`} className="my-1" />
                ) : value ? (
                  <CountrySelectOption
                    key={value}
                    country={value}
                    countryName={label}
                    selectedCountry={selectedCountry}
                    onChange={onChange}
                    onSelectComplete={() => setOpen(false)}
                  />
                ) : null
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CountrySelectOption({
  country,
  countryName,
  selectedCountry,
  onChange,
  onSelectComplete,
}: RPNInput.FlagProps & {
  selectedCountry: RPNInput.Country
  onChange: (country: RPNInput.Country) => void
  onSelectComplete: () => void
}) {
  return (
    <CommandItem
      className="gap-2"
      // Se busca por nombre o por código: "costa", "506".
      value={`${countryName} +${RPNInput.getCountryCallingCode(country)}`}
      onSelect={() => {
        onChange(country)
        onSelectComplete()
      }}
    >
      <FlagComponent country={country} countryName={countryName} />
      <span className="flex-1 text-sm">{countryName}</span>
      <span className="text-sm text-foreground/50">{`+${RPNInput.getCountryCallingCode(country)}`}</span>
      <CheckIcon className={cn("ml-auto size-4", country === selectedCountry ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  )
}

function FlagComponent({ country, countryName }: RPNInput.FlagProps) {
  const Flag = flags[country]
  return (
    <span className="flex h-4 w-6 shrink-0 overflow-hidden rounded-sm bg-foreground/20 [&_svg:not([class*='size-'])]:size-full">
      {Flag && <Flag title={countryName} />}
    </span>
  )
}

export { PhoneInput }
