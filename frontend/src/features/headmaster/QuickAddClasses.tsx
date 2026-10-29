import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LEVELS } from '@school/shared';
import { api } from '../../lib/api';
import { levelLabel } from '../../lib/format';
import { fullErrorMessage } from '../../lib/forms';
import { Alert } from '../../components/States';
import { refKeys } from '../reference';

/**
 * Shown where a class must be chosen while the school has none. The scheme of learning only
 * names levels (Basic 7 to 9); the school's own classes (B7A, B7B…) are created here or in
 * Settings. Not a <form>, so it can sit inside another form such as Add teacher.
 */
export function QuickAddClasses() {
  const qc = useQueryClient();
  const id = useId();
  const [level, setLevel] = useState<string>('BASIC_7');
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: async (classes: { level: string; name: string }[]) => {
      for (const c of classes) await api.post('/classes', c);
    },
    onSuccess: () => {
      setName('');
      void qc.invalidateQueries({ queryKey: refKeys.classes });
    },
  });
  const addOne = () => {
    if (name.trim()) add.mutate([{ level, name: name.trim() }]);
  };

  return (
    <div className="space-y-3 rounded-md border border-warn/40 bg-warn-soft px-3 py-3 text-sm">
      <p>
        <strong>No classes yet.</strong> The scheme of learning covers Basic 7 to 9, but the
        school&apos;s own classes, such as B7A and B7B, are added once here or in{' '}
        <Link to="/h/settings?tab=classes" className="font-medium underline">
          Settings → Classes
        </Link>
        .
      </p>
      <button
        type="button"
        className="btn-primary"
        disabled={add.isPending}
        onClick={() => add.mutate(LEVELS.map((l) => ({ level: l, name: `B${l.slice(-1)}` })))}
      >
        {add.isPending ? 'Adding…' : 'Add one class per level (B7, B8, B9)'}
      </button>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm" htmlFor={`${id}-level`}>
          <span className="label">Or add a class: level</span>
          <select
            id={`${id}-level`}
            className="input w-auto"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {levelLabel(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm" htmlFor={`${id}-name`}>
          <span className="label">Class name</span>
          <input
            id={`${id}-name`}
            className="input w-32"
            placeholder="B7A"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addOne();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="btn-secondary"
          disabled={add.isPending || !name.trim()}
          onClick={addOne}
        >
          Add class
        </button>
      </div>
      {add.isError && <Alert>{fullErrorMessage(add.error)}</Alert>}
    </div>
  );
}
