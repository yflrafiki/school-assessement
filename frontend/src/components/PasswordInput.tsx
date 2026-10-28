import { useState, type ComponentPropsWithRef } from 'react';
import { FiEye, FiEyeOff } from 'react-icons/fi';

type Props = Omit<ComponentPropsWithRef<'input'>, 'type'>;

/**
 * Password field with a show/hide button, so people can check what they typed.
 * Takes the same props as <input> (including react-hook-form's register and the
 * id / aria attributes that FormField adds), and always starts hidden.
 */
export function PasswordInput({ className = 'input', ...props }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`${className} pr-10`}
        // Never offer to spell-check or autocorrect a password, even while it is shown.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted hover:text-ink focus-visible:text-ink"
      >
        {visible ? (
          <FiEyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <FiEye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
