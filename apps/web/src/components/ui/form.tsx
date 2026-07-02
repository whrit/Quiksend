import { Slot } from "@radix-ui/react-slot";
import { createContext, use, useId } from "react";
import type * as React from "react";
import type { ControllerProps, FieldPath, FieldValues } from "react-hook-form";
import { Controller, FormProvider, useFormContext, useFormState } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Form = FormProvider;

interface FormFieldContextValue<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  name: TName;
}

const FormFieldContext = createContext<FormFieldContextValue<
  FieldValues,
  FieldPath<FieldValues>
> | null>(null);

export const FormField = <TFieldValues extends FieldValues, TName extends FieldPath<TFieldValues>>(
  props: ControllerProps<TFieldValues, TName>,
) => (
  <FormFieldContext.Provider value={{ name: props.name }}>
    <Controller {...props} />
  </FormFieldContext.Provider>
);

interface FormItemContextValue {
  id: string;
}
const FormItemContext = createContext<FormItemContextValue | null>(null);

export function useFormField() {
  const fieldContext = use(FormFieldContext);
  const itemContext = use(FormItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: fieldContext?.name });

  if (!fieldContext) throw new Error("useFormField must be used within <FormField>");
  if (!itemContext) throw new Error("useFormField must be used within <FormItem>");
  const fieldState = getFieldState(fieldContext.name, formState);

  return {
    id: itemContext.id,
    name: fieldContext.name,
    formItemId: `${itemContext.id}-form-item`,
    formDescriptionId: `${itemContext.id}-form-item-description`,
    formMessageId: `${itemContext.id}-form-item-message`,
    ...fieldState,
  };
}

export const FormItem = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  const id = useId();
  return (
    <FormItemContext.Provider value={{ id }}>
      <div className={cn("space-y-2", className)} {...props} />
    </FormItemContext.Provider>
  );
};

export const FormLabel = ({ className, ...props }: React.ComponentProps<typeof Label>) => {
  const { error, formItemId } = useFormField();
  return (
    <Label className={cn(error && "text-destructive", className)} htmlFor={formItemId} {...props} />
  );
};

export const FormControl = ({ ...props }: React.ComponentProps<typeof Slot>) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={Boolean(error)}
      {...props}
    />
  );
};

export const FormDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => {
  const { formDescriptionId } = useFormField();
  return (
    <p
      id={formDescriptionId}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
};

export const FormMessage = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error.message ?? "") : children;
  if (!body) return null;
  return (
    <p
      id={formMessageId}
      className={cn("text-sm font-medium text-destructive", className)}
      {...props}
    >
      {body}
    </p>
  );
};
